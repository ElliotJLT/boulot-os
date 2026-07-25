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
This is the front door. The launcher is built and works: it picks a free port,
waits for the server to answer before opening a tab, and prints where your files
are. It needs a published package and a smoke test on a machine that has never
seen the repo.

It is first because it is the only route that is both easy and unencumbered. A
Node script is not a quarantined app bundle, so it never meets Gatekeeper, never
shows a warning, and needs no money to distribute.

**A browser for anyone who has none.** PDF rendering needs a print engine, and
the renderer now looks for Chrome, Edge, Brave, Vivaldi or Chromium already
installed before considering a download, so on most machines this costs nothing
at all. What is left is the machine that genuinely has none, where the fallback
is currently a silent 190MB fetch by puppeteer. That needs to be a visible,
once-only download with a progress bar rather than a long unexplained pause.

## Later, when downloads justify it

**Sign and notarise the Mac app.** Deliberately not next, despite being the most
obvious-looking item on this list.

The `.dmg` builds today at 46MB and installs. It is unsigned, and on macOS 15
and 26 that is worse than it used to be: the Control-click override
[was removed in Sequoia](https://www.idownloadblog.com/2024/08/07/apple-macos-sequoia-gatekeeper-change-install-unsigned-apps-mac/),
so opening it means going to System Settings, finding Privacy and Security,
clicking Open Anyway, and confirming, all
[within an hour](https://wiki.hacks.guide/wiki/Open_unsigned_applications_on_macOS_Sequoia_and_newer)
of first seeing the warning. For a first-time user that is a timed hunt through
System Settings, prompted by a dialog containing the word malware. It is the same
cliff the app was built to remove, wearing a different coat.

Fixing it costs
[$99 a year](https://developer.apple.com/help/account/membership/program-enrollment/)
for an Apple Developer account, plus an App Store Connect API key. There is no
free tier: a free Apple account can sign locally but cannot notarise, and
self-signed certificates do not satisfy Gatekeeper. The commands are written into
`packages/desktop/scripts/build-dmg.sh` and fire as soon as
`APPLE_SIGNING_IDENTITY` is set.

It is not next because that money buys exactly one thing: handing a `.dmg` to
someone who downloads it from the internet. The quarantine flag behind all of
this only attaches on download, so both other routes avoid it entirely. `npx
boulot` never meets Gatekeeper, and an app you build yourself with
`pnpm desktop` opens normally because it was never downloaded. Buying the
certificate before anyone is downloading anything is solving a problem that does
not exist yet.

**Windows.** Tauri cross-compiles and the sidecar approach is the same. The
sticking point is that the Node binary is copied from the build machine, so a
Windows build has to run on Windows or fetch a Windows Node.

## After that

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
