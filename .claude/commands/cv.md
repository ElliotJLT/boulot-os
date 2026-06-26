# /cv

Generate a tailored CV for an active job using adversarial agent teams.

## Step 1: Gather inputs

1. Identify the user and active job (ask if ambiguous)
2. Read `USER/cv-master.md` for full experience
3. Read `USER/active/{company}/job.md` for JD
4. Read `USER/active/{company}/research.md` for company context (if exists)
5. Read `USER/learning.md` for patterns from previous applications (if exists)

## Step 2: JD mapping table

Before writing anything, map every JD requirement against the master CV:

| JD Requirement | Master CV Evidence | Match Type |
|---|---|---|
| ... | ... | Direct / Reframeable / Gap |

Present this table to the user. Flag gaps. This is non-negotiable — never skip it.

## Step 3: Adversarial agent team (run 3 sub-agents in parallel)

**Agent 1 — The Hiring Manager**: Read the JD as the person who wrote it. What are they actually worried about? What would make them stop reading? What's the one thing that would make them say "interview this person"? Draft the CV optimised for what the HM cares about, not what the candidate wants to say. Score each bullet 1-5 on relevance.

**Agent 2 — The Reviewer**: Read the draft against the JD. Where is a claim unsupported? Where does it sound generic when it could be specific? Where would a recruiter skim past? Return the 3 highest-impact edits — not a teardown, just the sharpest improvements.

**Agent 3 — The Strategist**: Read the JD against the full master CV. What experience is being underplayed? What's the non-obvious connection between the candidate's background and this role? What framing would make a generic bullet feel memorable? Find 3 bullets from the master CV that aren't in the current draft but should be.

## Step 4: Synthesis

After all 3 agents return:
- Take Agent 1's priority ordering and structure
- Apply Agent 2's edits to sharpen weak points
- Incorporate Agent 3's additions for non-obvious angles
- Edit once more for voice consistency (direct, no fluff, sounds like the candidate not a robot)
- Verify every JD requirement from the mapping table is addressed

## Step 5: Output

1. Write tailored CV to `USER/active/{company}/cv.md`
2. Show the JD mapping table with final CV evidence (confirm all gaps are addressed or flagged)
3. On request: generate PDF using `/pdf USER {company}`

## Rules

- NEVER fabricate experience. Only rearrange, emphasise, and reword existing bullets.
- NEVER skip the JD mapping table.
- Check `USER/learning.md` for what's worked before — reuse winning structures.
- Match JD language where natural. Don't keyword-stuff.
- The adversarial agents should DISAGREE — if all 3 agents produce the same output, the exercise failed.
