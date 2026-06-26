---
name: check-pipeline
description: Scan active applications, flag stale ones, remind about follow-ups, suggest next actions. Designed for /loop.
allowed-tools: Bash, Read, Glob, Grep
---

# /check-pipeline — Application Pipeline Health Check

Scan the user's active job pipeline and produce a status report.

## Steps

### 1. Get today's date
Run `date +%Y-%m-%d` to get today's date.

### 2. Scan all active applications
Read every `status.md` file in `USER/active/*/status.md` at ``.

### 3. Flag issues
For each application, check:
- **STALE**: `last_updated` > 21 days ago and no `next_action_date` set → suggest archiving
- **OVERDUE**: `next_action_date` is in the past → flag for immediate action
- **DUE TODAY/TOMORROW**: `next_action_date` is today or tomorrow → surface prominently
- **NO RESPONSE**: `stage` is `applied` and `last_updated` > 14 days → suggest follow-up
- **DEAD**: `stage` is `rejected`, `withdrawn`, or `expired` → auto-suggest archive

### 4. Output report
Format:

```
## Pipeline Check — <today's date>

### Action Required
- <company>: <what needs doing> (due: <date>)

### Waiting (no action needed)
- <company>: <status> (last updated: <date>)

### Stale — Consider Archiving
- <company>: <days since update>, <reason>

### Next 3 Moves
1. <most urgent>
2. <second>
3. <third>
```

### 5. Update dashboard
Read and update `USER/dashboard.md` to reflect current state. Update the "Last updated" date, active applications table, and next 3 actions.
