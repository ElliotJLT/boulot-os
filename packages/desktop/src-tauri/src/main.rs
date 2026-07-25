#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Boulot, as a desktop application.
///
/// The window is a webview pointed at a server running on this machine. That is
/// the same architecture OpenWorker uses (a compiled Python server as a sidecar,
/// a Tauri shell around it) and it is chosen here for the same reason: the whole
/// product already is a local server and a web interface, so wrapping is a
/// packaging problem rather than a rewrite.
///
/// What this buys is the only thing it needs to buy. `npx boulot` still asks
/// someone to have Node installed and to open a terminal, and the person this
/// was built for does neither. A double-clickable icon is the difference between
/// a tool she uses and a tool she is told about.

struct ServerHandle(Mutex<Option<CommandChild>>);

/// Ask the OS for a port rather than picking one.
///
/// Binding to port 0 and reading back the assignment is the only approach
/// without a race. Anything that probes a port and then binds it can lose the
/// gap in between, which on a laptop with a dev server already running is not a
/// rare event.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(4319)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerHandle(Mutex::new(None)))
        .setup(|app| {
            let port = free_port();

            // The vault lives beside the user's other documents, not inside the
            // app bundle. An app that keeps your CVs where an uninstall deletes
            // them has misunderstood whose files they are.
            let vault = app
                .path()
                .home_dir()
                .map(|h| h.join("Boulot"))
                .unwrap_or_else(|_| std::path::PathBuf::from("Boulot"));

            /*
             * The sidecar is `node`, so it needs the script to run.
             *
             * Resolved through Tauri's resource API rather than assembled from
             * the executable's path: inside a signed .app the layout is
             * Contents/Resources, and in `tauri dev` it is a directory in the
             * repo. Only the resolver knows both.
             */
            let entry = app
                .path()
                .resolve("server/start.mjs", tauri::path::BaseDirectory::Resource)
                .expect("the server bundle is missing from this build");

            let sidecar = app
                .shell()
                .sidecar("boulot-server")
                .expect("boulot-server sidecar is missing from the bundle")
                .args([entry.to_string_lossy().to_string()])
                .env("PORT", port.to_string())
                .env("BOULOT_VAULT", vault.to_string_lossy().to_string());

            let (_rx, child) = sidecar.spawn().expect("could not start the Boulot server");
            app.state::<ServerHandle>().0.lock().unwrap().replace(child);

            let url = format!("http://127.0.0.1:{port}");
            let win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().unwrap()),
            )
            .title("Boulot")
            .inner_size(1280.0, 860.0)
            .min_inner_size(1040.0, 700.0)
            .build()?;

            // The server needs a moment before it answers. Showing the webview's
            // own connection-refused page first reads as a broken app rather
            // than a starting one.
            win.hide()?;
            let handle = win.clone();
            std::thread::spawn(move || {
                for _ in 0..120 {
                    if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                let _ = handle.show();
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Boulot")
        /*
         * Quitting must take the server with it.
         *
         * This was a WindowEvent::Destroyed handler, which sounds equivalent and
         * is not: quitting from the menu or with Cmd-Q exits the process without
         * ever destroying the window, so the sidecar outlived the app and kept
         * its port. Caught by quitting the built app and finding boulot-server
         * still in the process list.
         *
         * RunEvent::Exit fires on every route out, including the ones that skip
         * the window entirely.
         */
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<ServerHandle>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
