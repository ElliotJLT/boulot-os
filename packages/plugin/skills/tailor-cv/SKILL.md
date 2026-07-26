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

Read exactly these files. Do not search for them, the paths are fixed:

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

## Read each thing once

One measured run of this skill cost $5.90. It searched the vault nine times,
read the job description four times, the master record three times, and the CV
it had just written three times. None of those files changed while it worked.

- The job description is usually **given to you in the prompt**. If it is there,
  do not open `job.md`.
- Read `cv-master.md` **once**. It is the evidence bank and it does not change
  mid-run.
- Read `research.md` **once**, and only if you need the company angle.
- Do not go looking through `archive/` or other applications for reference CVs.
  Past CVs are a weak structural hint and an expensive one; the master record
  and the JD are what the CV is built from.
- Never re-read a file you have already read in this run.

**Read the `writing-voice` skill first and hold it while you write.**

That rule used to arrive by itself. On the machine this system grew up on there
is an always-on anti-AI-writing rule that applies to every piece of prose, so a
CV got it whether or not anything asked. The app deliberately loads no personal
settings, so nothing arrives by itself here and the CV, the single most-read
thing this produces, was the one document written without it.

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

Delegate to the three named subagents, **in a single message so they run in
parallel**: `hiring-manager`, `reviewer`, `strategist`. Give each the paths to
the JD and the draft. Their briefs are already defined; do not restate them.

> If all three come back agreeing, the exercise failed. Three agents producing
> one answer is three times the cost for one opinion. The value is the conflict.
> Say so, and run it again with sharper briefs.

## Step 4: Synthesise

Take the Hiring Manager's ordering, apply the Reviewer's edits, add the
Run them only when the request asks for a review. They are three subagents that
each re-read the CV and the job description and write at length, so they roughly
double the cost of tailoring a CV, and most applications do not need an
adversarial panel to find their problems.

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

**Three sentences. Forty to sixty words.** A summary is the thing a reader
decides on in four seconds, and past about sixty words they stop reading and
skim to the bullets, which means the summary spent its one job describing
itself. If it runs past three sentences, it is a biography and needs cutting,
not rewording.

One claim per sentence: what you own, the hardest thing you have shipped, and
why this employer specifically. Nothing that repeats a bullet verbatim.
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
- Use em-dashes. Not one, anywhere in the prose. They are the strongest single
  tell that a machine wrote this, and a CV covered in them reads as unedited
  output no matter how true its contents are. Full stops, commas and colons do
  the same work
- Reach for "leverage", "robust", "seamless", "spearheaded", "delve",
  "testament to" or their neighbours. The `writing-voice` skill has the list
  where it is not.
