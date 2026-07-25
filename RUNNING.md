# Running Boulot

```bash
export BOULOT_VAULT="/Users/elliot/conductor/workspaces/Boulot/beijing/Boulot"
pnpm start
```

Then open <http://localhost:4319>.

`BOULOT_VAULT` points at the folder containing `ELLIOT/` and `CHARLOTTE/`.
Defaults to `~/Boulot` if unset. Nothing is written to the vault: the app only
reads it.

No API key is needed for the board, the funnel, or the PDF preview. Only the
agent features require one, and they read `~/.boulot/.env`.

To stop it: `lsof -ti:4319 | xargs kill`
