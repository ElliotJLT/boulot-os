---
name: apply
description: Quickfire job application — research company, tailor CV, draft cover letter, set up tracking folder. One command.
allowed-tools: Agent, Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# /apply — Quickfire Application

You are running a quickfire application workflow for the user. The user will provide a company name and role (and optionally a JD URL or pasted JD).

## Inputs
- `$ARGUMENTS` contains: `<company> <role>` and optionally a URL or pasted JD

## Steps

### 1. Parse input
Extract company name, role title, and any JD URL/text from $ARGUMENTS.

### 2. Get the JD
- If a URL was provided: fetch it with `curl` (browser User-Agent). If blocked, use `firecrawl scrape`.
- If JD text was pasted: use that directly.
- If neither: search the web for the job listing. Try `<company> <role> job listing site:greenhouse.io OR site:lever.co OR site:ashbyprod.com OR site:jobs.workable.com` first.
- Save the JD to `USER/active/<company-slug>/jd.md`

### 3. Research (parallel agents)
Run 2 agents in parallel:
1. **Company research**: What they do, funding, team size, recent news, tech stack if known. Save to `USER/active/<company-slug>/research.md`
2. **Role analysis**: What the JD actually asks for (explicit + implicit), what the hiring manager likely cares about, what would make them stop reading

### 4. Tailor CV
- Read `USER/cv-master.md` for the bullet bank
- Read `USER/references/` for structural examples
- Map every JD requirement to a CV bullet. Flag gaps.
- Build a tailored CV at `USER/active/<company-slug>/cv.md`
- Follow the rules in `.claude/rules/cv-writing.md` and `.claude/rules/ai-writing.md`
- Present the JD→CV mapping table to the user before finalising

### 5. Draft cover letter (if needed)
- Only if the application requires one or the user asks
- Follow `.claude/rules/application-answers.md`
- Save to `USER/active/<company-slug>/cover-letter.md`

### 6. Create status.md
```yaml
---
company: <Company Name>
role: <Role Title>
stage: applying
applied_date: <today>
last_updated: <today>
next_action_date: <today + 7 days for follow-up>
salary_range: <from JD or TBC>
source: <where found>
notes: <one-liner>
---
```

### 7. Update dashboard
- Read `USER/dashboard.md`
- Add the new application to the Active Applications table
- Update the "Next 3 Actions" if relevant

### 8. Present to the user
Show:
- JD→CV mapping table (requirement | CV evidence | hit/gap)
- Any gaps flagged
- The tailored CV for review
- Ask: "Ready to submit, or want to adjust?"

## Rules
- NEVER fabricate experience. Only rearrange, emphasise, and reword existing bullets from cv-master.md.
- Run the anti-AI writing check on everything you draft.
- Apply the swap test to any cover letter content.
- Company slug format: kebab-case (e.g., `keith`, `eleven-labs`, `firstminute`)
- If you can't find the JD, ask the user to paste it. Don't guess.
