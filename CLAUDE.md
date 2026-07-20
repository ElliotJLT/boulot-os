# Boulot — Career Ops System

## Auto-loaded context
@USER/profile.md
@USER/cv-master.md
@USER/dashboard.md

## Who uses this
- This vault is set up for **one job seeker**, whose files live in the `USER/` folder.
- Everything that person is — their background, target roles, salary target — lives in `USER/profile.md`. Read it first; it defines who you're working for.
- (Leave the `USER/` folder as it is — it just works. Only rename it if you're comfortable editing files, since you'd then need to update the three `@USER/...` lines above and find-and-replace `USER/` across the `.claude/` folder.)

## Always do first
1. **Check if this is a first-time user.** `USER/profile.md` and `USER/cv-master.md` are auto-loaded above. If they are still the blank template (placeholder prompts, empty fields, no real name or experience), the user has not set up yet. Do NOT try to run a job search or read empty job folders. Instead, welcome them and run the onboarding in `/start`: interview them one question at a time and write their profile and master CV. Everything else depends on this being filled in.
2. If the profile and CV are filled in, read them to understand the candidate before doing anything.
3. Run a status check on active jobs: scan `USER/active/*/status.md` for any with `last_updated` > 14 days ago. Flag stale ones.
4. Check for any jobs where `stage: rejected` or `stage: withdrawn` and auto-move to archive.

## Pipeline — Discovery vs Active

Jobs flow through two stages:

```
USER/pipeline/  →  USER/active/  →  USER/archive/
(looking)            (applying)         (done)
```

### `USER/pipeline/`
- Roles you're researching or considering but haven't committed to applying for
- Each role gets a single file: `{company}.md` with company, role, salary, link, fit notes, and a verdict field (`interested` / `applied` / `pass`)
- When a role moves to `applied`, create the full folder in `active/` and delete the pipeline file
- When a role is a `pass`, delete the file (no need to archive research)
- Pipeline is disposable — it's a scratch pad, not a record

### `USER/active/`
- Only roles you are actively applying to or interviewing for
- Full folder structure: `status.md`, `cv.md`, `job.md`, optional `research.md`, `prep.md`, `cover-letter.md`

### When presenting options
- **3 next actions max.** Never dump a 20-item list without forcing a priority call. Present the top 3, then offer to show more.
- After any research session, end with: "Which 3 do you want to move on?"

## Date awareness
- Today's date: use `date` command to get current date
- Every job in `active/` has a `status.md` with fields:
  - `applied_date`, `last_updated`, `next_action_date`, `stage`
- If `last_updated` is >21 days ago and no `next_action_date` set: mark as STALE and suggest archiving
- If `stage` is `rejected`, `withdrawn`, or `expired`: auto-move to `archive/`
- Never prep for or reference archived jobs unless explicitly asked

## Dashboard
- Each user has a `USER/dashboard.md` — a live view of their pipeline and active applications
- Claude updates this after any structural change (new application, stage change, archive)
- Format: pipeline roles (one-liner each) + active applications table (company, role, stage, last updated, next action) + 3 recommended next actions

## CV System — Three Layers

### 1. Master CV (`USER/cv-master.md`)
- The SUPERSET of all experience — every role, every bullet, fully tagged
- This is the canonical source of truth. Nothing gets left out.
- Each bullet is tagged by skill area (e.g. #ops #ai #capacity #regulated #gtm)
- Used for SELECTION: the CV tailor pulls atomic bullets from here

### 2. Reference CVs (`USER/references/`)
- 2-3 real CVs that actually landed interviews, kept as-is
- Annotated with: what role type they targeted, what worked structurally
- Used for NARRATIVE: shows CC how to assemble bullets into a coherent read
- e.g. "for this ops-heavy role, arrange like the Farringdon CV"

### 3. Tailored CVs (`USER/active/{company}/cv.md`)
- Generated per application by combining the right bullets (from master) with the right structure (from references)
- Tailoring = select relevant bullets + order them so the whole thing reads coherently for this specific role
- NEVER fabricate experience. Only rearrange, emphasise, and reword existing bullets.
- Output format: markdown first for review, then generate .docx on request using docx-js
- The .docx should match a clean, professional single-column format similar to Wozber output

## Interview Prep
- When a job reaches `stage: interview`, auto-generate prep at `USER/active/{company}/prep.md`
- Prep includes: JD→CV mapping table, likely questions with CV-backed answers, gaps to own, questions to ask
- Update prep after each call/stage (incorporate what was discussed, what landed, what didn't)

## Research
- For each active job, maintain `USER/active/{company}/research.md`
- Include: company overview, recent news, funding, team, competitive landscape, regulatory context
- Use web search to find current information
- Update research before any prep session

## Stories Library
- `USER/stories/` contains reusable STAR stories
- Each story file has: situation, task, action, result, metrics, which roles it maps to
- When prepping for a new role, pull relevant stories and adapt framing

## Agent Teams

The point of agents is **pressure-testing, not division of labour.** Three agents agreeing is worthless. Three agents arguing produces better output.

### Application Writing (CV + Statement/Cover Letter)
Run 3 agents in parallel, each with a different adversarial lens:

1. **The Hiring Manager** — reads the JD as the person who wrote it. What are they actually worried about? What would make them stop reading? What's the one thing that would make them say "interview this person"? Drafts the application optimised for what the HM cares about, not what the candidate wants to say.

2. **The Reviewer** — reads the draft as a second pair of eyes. Where could something be clearer? Where is a claim unsupported? Where does it sound generic when it could be specific? Returns targeted feedback on the 2-3 things that would most improve the draft. Not looking to tear it apart — looking to sharpen what's already working.

3. **The Strategist** — reads the JD against the candidate's full master CV and identifies the non-obvious angles. What experience does the candidate have that they're underplaying? What's the unexpected connection between their background and this role? What framing would make a generic-sounding bullet feel specific and memorable?

**After all 3 return:** Compile into a single draft that takes the HM's structure, addresses the Sceptic's weaknesses, and incorporates the Strategist's angles. Then edit for voice consistency.

### New Job Research
3 agents — company research, role analysis, competitive landscape. Run in parallel.

### Interview Prep
3 agents with adversarial lenses:
1. **Friendly interviewer** — questions that let the candidate shine, likely openers
2. **Hostile interviewer** — probes gaps, challenges claims, asks "why should we hire you over someone with actual [X] experience?"
3. **Gap analyst** — maps JD requirements against CV, identifies exactly where the candidate is strong/weak/bluffing, suggests how to own gaps honestly

Do NOT use agent teams for:
- Simple status checks
- Single-file edits
- Quick questions

## Companies Intelligence Layer (optional, bring-your-own-data)

Boulot can build a queryable SQLite database of target companies at `shared/companies.db`.
The database is NOT shipped — you build it from a CSV of companies you provide.

### How to use
- Get a CSV of target companies (e.g. an export of recently-funded companies in your market) and save it at `shared/companies.csv`.
- Build the database: `python3 shared/build_companies_db.py`
- Query with SQL via `sqlite3 shared/companies.db "SELECT ..."`
- Typical columns: `name`, `sector`, `sub_sector`, `location`, `employees`, `funding_amount`, `funding_round`, `ai_native`
- Use for: finding target companies, cross-referencing pipeline, enriching research

### Shortlists
- When the candidate's target roles are clear, generate a shortlist from the database and save it to `shared/shortlist.md`.
- Refresh it when the pipeline or target roles change.

## Learning Log
- Each user has `USER/archive/learning.md` — aggregated patterns from all archived applications
- When archiving a job, update learning.md with: what happened, what worked, what didn't, any reusable lessons
- Track stats: total archived, applied, got interviews, ghosted, rejected, withdrawn
- Surface patterns: which role types get traction, which don't, common gap feedback, what positioning landed
- If `learning.md` doesn't exist for a user, create it on first archive

## Tone
- Direct and honest. Don't sugarcoat weak answers.
- Push for specifics: numbers, names, outcomes.
- Flag when an answer would be generic or waffly.
- Keep the candidate focused on shipping applications, not endlessly polishing the system.
