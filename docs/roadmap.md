# Roadmap

What is built, what is next, and what has been ruled out. Ordered by how much it
changes for the person using it, not by how interesting it is to build.

## Now

**Run it on localhost.** Clone the repo, `pnpm install`, `pnpm start`. The app
opens at `localhost:4319`. First run asks your name, then asks you to paste your
current CV, and turns it into your record. Nothing is hosted, nothing is
uploaded, and your files live in `~/Boulot` as plain markdown.

This is the route that works today and it is the one to link to.

## Next

**Publish `boulot` to npm** so the command is `npx boulot` rather than a clone.
The launcher is built and works: it picks a free port, waits for the server to
answer before opening a tab, and prints where your files are. It needs a
published package and a smoke test on a machine that has never seen the repo.

**Sign and notarise the Mac app.** The `.dmg` builds today at 46MB and installs.
It is unsigned, so macOS shows "Apple could not verify this app is free of
malware" on first launch, and a first-time user reads that as "this is a virus".
That is a worse outcome than the terminal it was meant to replace.

Unblocking it needs an Apple Developer account at
[$99/year](https://developer.apple.com/help/account/membership/program-enrollment/),
an App Store Connect API key, and `xcrun notarytool` in the build. The commands
are written into `packages/desktop/scripts/build-dmg.sh` and fire as soon as
`APPLE_SIGNING_IDENTITY` is set. Until then the honest instruction is right
click, Open.

**Windows.** Tauri cross-compiles and the sidecar approach is the same. The
sticking point is that the Node binary is copied from the build machine, so a
Windows build has to run on Windows or fetch a Windows Node.

## After that

**Chromium on first render, with a progress bar.** PDF rendering needs a
browser, and Chromium is 380MB against a 46MB app, so bundling it would make
everyone pay for a feature not everyone uses. Right now it resolves whatever
puppeteer already downloaded, which is true on a developer's machine and false
on anyone else's. The download needs to happen once, visibly, the first time
someone exports a PDF.

**Email ingestion.** Rejections, interview invitations and recruiter replies all
arrive by email, so the status changes a user currently reports by hand are
sitting in an inbox. The tracker only works if it is never maintained manually.
Open questions are in `docs/ideas.md`.

**Interview preparation.** The vault has `stories/` and the plugin has a `prep`
skill, neither of which the app surfaces yet.

## Ruled out

**A hosted version.** Not a hosting bill nobody is paying, but a design
position: the value is that your career files are files, on your disk, that you
can read without this app existing. A server holding them changes what the
product is.

**A PWA.** Suggested as a shortcut to a Mac download and it is a dead end. A PWA
runs in the browser sandbox: it cannot spawn the local server, cannot run the
Agent SDK, and cannot read `~/Boulot`. The File System Access API covers part of
the file problem, is Chromium-only, and still leaves the other two.

**Auto-apply, and anything that optimises for volume.** Reply rates collapsed
because of tools that fire 200 applications a day. Fewer applications, each one
much better, is the entire bet.

**An "ATS score".** It would be invented. The mapping table is the honest
version of the same promise: every requirement, matched to something you have
actually done, with the gaps named rather than hidden.
