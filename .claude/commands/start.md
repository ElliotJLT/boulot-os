# /start

First-time setup for a new Boulot user. Run this whenever `USER/profile.md` and
`USER/cv-master.md` are still the blank template.

Goal: by the end, `USER/profile.md` and `USER/cv-master.md` are filled in with the
user's real details, and the user knows how to apply for their first role.

## 1. Welcome (keep it to a sentence or two)
Boulot tailors your CV to each role, researches companies, drafts cover letters, and
runs tough mock interviews — all on your own machine. First it needs to learn about you.
Say that simply, then start the interview.

## 2. Build the profile (write to `USER/profile.md`)
Interview the user ONE question at a time. Do not paste the whole form and ask them to
fill it. Have a conversation. Work through, roughly in this order:
- Name and contact details
- Their current situation (employed? notice period? anything to always keep in mind)
- The roles, industries, and salary they're aiming for
- Their career history, one role at a time
- What makes them different from other candidates
- Where they feel weak or undersold
- How they want you to talk to them (blunt? encouraging? push for numbers?)

Write answers into `USER/profile.md` as you go, in their own words. Save after each
section so nothing is lost if they stop.

## 3. Build the master CV (write to `USER/cv-master.md`)
The fast path: ask them to paste an existing CV or their LinkedIn. Turn it into the
tagged master format — every role, with bullets tagged by skill area (`#ops`, `#ai`,
`#sales`, `#regulated`, etc). If they have no CV, interview them role by role for what
they did and the numbers behind it.
- NEVER invent experience, metrics, or skills. Only record what they actually tell you.
- Read it back and confirm it's accurate before moving on.

## 4. Show them what's next
Tell them they're set up. To apply for their first role:
- Paste a job link, or run `/new-job`
- `/cv` tailors the CV to it (three agents argue over the draft)
- `/pdf` turns it into a polished PDF
- `/prep` runs a tough mock interview
Then offer to start their first application right now.

## Rules
- One question at a time. This is a chat, not a form.
- Save progress to the files as you go.
- Keep it short and human. Don't lecture.
