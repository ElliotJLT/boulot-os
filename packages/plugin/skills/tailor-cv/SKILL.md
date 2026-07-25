---
name: tailor-cv
description: Write or rewrite a tailored CV for a specific job, using three adversarial reviewers. Use when the user wants a CV for a role, wants an existing CV sharpened against a job description, or asks what their CV is missing for a job.
---

# Tailor a CV

Produce a CV for one specific role by selecting from the master experience bank
and arranging it the way this employer needs to read it.

The rules below are in this skill rather than a path-scoped rule file on
purpose. Path-scoped rules attach only once a matching file is touched, which
is after the decisions here have already been made.

## Step 1: Gather

Read, in this order:

1. `cv-master.md` — the full experience bank. Bullets are numbered and tagged
   (`#ops #ai #evals #regulated`). The tags are the selection index.
2. `active/{company}/job.md` — the job description.
3. `active/{company}/research.md` — company context, if it exists.
4. `references/` — CVs that actually landed interviews. These are for
   **structure**, not content: how bullets were arranged into a coherent read.
5. `archive/learning.md` — what has and has not worked before, if it exists.

The three-layer model matters: master CV gives you **selection**, references
give you **narrative**, and the tailored CV is selection arranged in that
narrative.

## Step 2: The mapping table. Never skip this.

Before writing a word, map every requirement in the JD against the master CV:

| JD requirement | Master CV evidence | Direct / Reframeable / Gap |
|---|---|---|

Show it. Flag the gaps out loud. A gap that is named is a thing to address in a
cover letter or an interview; a gap that is quietly skipped is a thing that
surfaces when someone else finds it.

Two failure modes to watch:

- **Under-claiming.** If the candidate has done it, find the bullet where it
  belongs. Real experience going unmentioned is the most common defect.
- **Over-claiming.** Never invent experience. Reword, reorder, reframe, and
  emphasise only. If it is not in the master CV or the profile, it does not go
  in the CV.

## Step 3: Three reviewers, in parallel, who must disagree

Spawn three subagents with opposed briefs. Run them at the same time.

**The Hiring Manager.** Read the JD as the person who wrote it. What are they
actually worried about? What makes them stop reading? What single thing makes
them say "interview this one"? Score every bullet 1 to 5 on relevance to *this*
posting and return the ordering they would want.

**The Reviewer.** Read the draft against the JD. Where is a claim unsupported?
Where is it generic when it could be specific? Where would a recruiter skim?
Return the **three highest-impact edits**. Not a teardown. The three that move
it most.

**The Strategist.** Read the JD against the *whole* master CV, not the draft.
What is being underplayed? What is the non-obvious connection between this
background and this role? Return **three bullets from the master CV that are
missing from the draft and should not be**.

> If all three come back agreeing, the exercise failed. Three agents producing
> one answer is three times the cost for one opinion. The value is the conflict.
> Say so, and run it again with sharper briefs.

## Step 4: Synthesise

Take the Hiring Manager's ordering, apply the Reviewer's edits, add the
Strategist's missing bullets, then edit once for voice. It should read like the
candidate wrote it on a good day, not like a model wrote it.

Check every row of the mapping table is addressed or explicitly flagged.

## Step 5: Write and render

Write to `active/{company}/cv.md`. The format the renderer expects:

```markdown
# Full Name

**Headline line, wrapped in double asterisks**

+44 ... | you@example.com | linkedin.com/in/you | London, UK

---

## Summary
...

## Experience

### Company — Role Title
**Dates** | context line

- Achievement with a number in it
```

The headline **must** carry its `**` wrapper and the contact line **must** be
pipe-separated. If the headline is not wrapped, the renderer reads the contact
line as the headline and drops both, producing a CV with no way to reach the
candidate.

Then call `boulot_render_pdf`. It returns a fit report.

- **Fits:** done. Tell the user the page count.
- **Too long:** the report gives a character budget and names the heaviest
  section. Cut that many characters **in one edit** and re-render. Do not shave
  and retry repeatedly, the number is measured from the real layout. Note that
  what physically spills off the last page is usually Education, Skills and
  Languages, which are compact and worth keeping. What is actually bloated is
  normally Experience.
- **No contact line:** fix the header as above, do not retry blind.

## Never

- Invent experience, a metric, a date, or a title.
- Claim a CV is ready without showing the mapping table.
- Keyword-stuff. Match the JD's language where it is natural and leave it alone
  where it is not.
