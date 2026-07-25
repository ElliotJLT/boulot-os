# Banked ideas

## Email ingestion (Elliot, 2026-07-25)

Hook email up so the agent tracks applications without being told. Rejections,
interview invites and recruiter replies all arrive by email, so the status
transitions the user currently has to report are sitting in an inbox.

Why it matters: the tracker only works if it is never maintained by hand. Email
is the difference between "tell the agent you got rejected" and the agent
already knowing.

Open questions: read-only IMAP or a Gmail connector; how to match a thread to a
company folder without false positives; what to do with a rejection that arrives
for a role that was never logged.

## Design direction (Elliot, 2026-07-25)

Minimalist and deliberately not AI-coloured. No warm-cream-and-terracotta house
style, no gradients. The board is a receipt for what the agent did, not a
product surface: the agent owns the vault, the UI shows the state.
