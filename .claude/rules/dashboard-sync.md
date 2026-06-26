---
paths: "**/status.md,**/dashboard.md"
---

# Dashboard Auto-Sync

After ANY change to a status.md file (new application, stage change, archive), you MUST also update `USER/dashboard.md`:
1. Update the Active Applications table to reflect the change
2. Update the "Last updated" date
3. Recalculate the "Next 3 Actions" based on current state
4. If a role was archived, move it to the Archived section with a one-liner reason

Do this automatically — don't ask the user if they want the dashboard updated.
