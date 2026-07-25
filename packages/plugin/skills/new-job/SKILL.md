---
name: new-job
description: Start tracking a new role from a job link or pasted description. Use when the user shares a job posting, a URL, or says they want to apply somewhere. Sets up the folder, researches the company, and reports fit before any CV is written.
---

# Start a new application

## Step 1: Get the job description

If given a **URL**, call `boulot_fetch_job` first, always. Ashby, Greenhouse,
Lever and Workable publish the description as structured JSON, and about half of
this vault's applications come from those boards. Fetching the page instead
returns a JavaScript shell and a title.

It will also tell you if a posting has been closed or unlisted, which is a
different problem from being unable to read it, and worth relaying accurately.

Only if that fails, try `WebFetch`. If that also fails, say so plainly and ask
for the text:

> I could not read that page, a lot of job boards block it. Paste the
> description and I will carry on.

Never guess at a job's contents from its URL, and never half-fill a folder from
a failed fetch. An application built on an invented JD is worse than none.

If given **pasted text**, use it directly.

## Step 2: Set up the folder

Slug is kebab-case from the company name. Create `active/{slug}/`:

- `job.md` — the description, the role title, the source, the link.
- `status.md` — frontmatter:

```yaml
company: Acme
role: Head of Operations
stage: lead
applied_date:
last_updated: <today, via boulot_today>
next_action_date: <deadline, or today + 7>
url: <link>
source: <greenhouse | linkedin | referral | ...>
salary:
```

Use `boulot_today` for the date. Do not guess it.

## Step 3: Research, then report

**Budget: at most 8 web searches.** Stop when you have enough to answer the four
questions below, not when you have exhausted the internet. A run that made 130
searches and read 188 pages cost twelve dollars and told the user nothing they
could not have got from six.

Answer only:

1. What does this company actually do, and who pays them?
2. Funding, stage, and headcount, dated.
3. Who would this role report to, and what team shape.
4. Anything that reads as a red flag.

**Do not** benchmark salaries across the market, survey competitors, or research
adjacent companies. If the posting states compensation, record it. If it does
not, write "not stated" and move on. Market-rate research is a separate request
the user can make deliberately.

Prefer primary sources over aggregators, and date every claim. Write it to
`research.md`.

Also check `archive/` for whether this company has been applied to before, and
whether any active application conflicts with it.

## Step 4: Report and stop

Present:

1. What the company actually does, in two lines.
2. The three strongest fits against the master CV.
3. The gaps, named honestly.
4. Anything concerning found in research.

Then ask whether to tailor the CV. **Do not write the CV in this step.** Setting
up a folder and writing an application are different decisions, and the user
should get to make the second one after seeing the research.
