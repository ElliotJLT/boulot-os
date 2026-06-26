# /archive

Archive a completed role and capture learnings.

## When to run
- Role reaches `stage: rejected`, `stage: withdrawn`, `stage: expired`, or `stage: ghosted`
- The user explicitly says to archive a role
- `/status` flags a role as STALE and the user confirms archival

## Steps

### 1. Gather outcome data
Ask the user (if not already known):
- **Stage reached** — how far did this get? (researching / applied / phone_screen / interview / final_round / offer)
- **Outcome** — what happened? (rejected / ghosted / withdrawn / offer_declined / offer_accepted / never_applied)
- **What worked** — any positive feedback? What got good reactions? Which CV elements landed?
- **What didn't work** — gaps flagged? Questions that stumped? Weak answers? Process failures?
- If the user has nothing to add (e.g. ghosted after applying), that's fine — fill in what's available from existing files.

### 2. Move to archive
```
mv USER/active/{company}/ USER/archive/{company}/
```

### 3. Create outcome.md
- Use `USER/archive/_outcome-template.md` as the base
- Fill in all frontmatter fields from `status.md` + the user's input
- Populate: stage flow, what worked, what didn't, lessons
- Be specific — generic lessons ("could have prepared better") are useless
- Pull from call notes, prep docs, and status history if they exist
- Reference the CV filename used (check `{company}/cv.md` or `status.md`)

### 4. Update learning.md
Read `USER/learning.md` and update:
- **Application stats table** — increment counts
- **What Gets Callbacks** — add any new CV/channel insights
- **Interview Performance** — add any new answer patterns (good or bad)
- **Gaps That Keep Getting Flagged** — increment or add gaps
- **Role Type Patterns** — add to respond/ghost/not-worth categories
- **Process Insights** — add any new meta-learnings
- **Repeatable Assets** — add any new reusable answers/CVs/stories
- Update the "Last updated" date

### 5. Update dashboard
- Remove the role from the Active Applications table
- Add a one-liner to the Archived section with: company, role, outcome
- Don't change Next 3 Actions unless one of them referenced this role

## Rules
- Don't delete any files from the active folder — move the whole folder to archive
- Don't fabricate feedback — if no signal was received, say "no signal received"
- Keep lessons actionable and specific, not generic
- Update the correct user's `USER/learning.md` and `USER/dashboard.md`
- If the role had prep docs or call notes, reference them in the outcome — that's where the richest data lives
