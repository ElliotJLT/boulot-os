# Consolidation

Boulot reads the applications you have finished with and writes down what it
learned. It happens when you archive something, it costs nothing, and there is
nothing to approve.

This document explains what it does, what it deliberately refuses to do, and
where the idea came from.

## The problem it solves

Every application is a round of writing. You rephrase a bullet for a particular
job, sharpen a number because that job description asked for it, send the CV,
and file the folder away. The next application starts from the master record,
which learned nothing from any of that.

Measured against a real vault of 22 sent CVs and 33 master entries, the drift is
not subtle:

* 44 distinct claims had been written more than once. Only some were in the
  master record.
* Four master entries were factually behind the CVs that went out. The record
  said "managed complaints handling" where the sent version said "NPS from 20 to
  80+". It was missing a 30% reduction in enterprise sales cycles, a 30+ market
  count, and two budget figures.
* Nine projects appeared across the CVs, one of them in 14 of them, and the
  master record had no projects section at all.
* Eleven master entries had never once been selected by tailoring.

So the record was simultaneously stale, incomplete and bloated, and no amount of
discipline fixes that, because the moment you would fix it is the moment you
have just finished an application and want to stop thinking about it.

## Where the idea came from

Anthropic ships a feature called Dreaming: a pass over an agent's memory files
that runs between sessions, merging overlapping entries, deleting contradicted
facts, converting relative dates to absolute ones, and rebuilding a lean index
that points at topic files. In Claude Code the same thing exists as `autoDream`,
still unreleased, triggered once 24 hours and five sessions have passed.

The shape fits this problem almost exactly, because a folder of archived
applications is the same kind of input as a directory of session transcripts. It
is a pile of finished work nobody will read again that happens to contain
everything worth knowing about the person who produced it.

The four phases map cleanly:

| Phase | Here |
|---|---|
| Orient | Read the existing `profile/`, so the run can report what changed |
| Gather signal | Group every bullet from every sent CV into one claim per thing said |
| Consolidate | Reconcile against the master record, find figures the record lacks, find claims you stopped making |
| Prune and index | Write `MEMORY.md` as a capped index, demote detail to `evidence.md`, `projects.md`, `questions.md` |

The trigger is the one thing that changes. Dreaming waits for elapsed time and a
session count, because sessions are its unit of work. Boulot's unit of work is
an application, and one being archived is unambiguous: there is something new to
learn and nothing left to wait for.

## Two deliberate departures

**No model.** Every phase is string comparison, so consolidation runs on a
machine with no API credit at all. This is not a limitation being worked around.
The useful operations here are merge, count and compare, and a model would only
contribute nicer phrasing to sentences that already survived being sent to an
employer.

**It asks rather than decides.** This is the important one. Dreaming consolidates
an agent's memory of a user. Boulot consolidates a person's record of
themselves, and that record becomes claims made to employers. A wrong fact in an
agent's memory is annoying. A wrong fact here is a fabrication with the user's
name on it.

So consolidation may only reconcile between sentences the user actually wrote and
sent. It merges, counts, dates and retires. It never synthesises a claim. Where
the record is ambiguous it opens a question instead of picking an answer:

> **Zero Gravity is dated "Feb 2022 – Present"** — A relative date goes out on
> every CV and silently becomes wrong the day it ends.

Dreaming would resolve that date. Consolidation cannot, because the answer is a
fact about someone's life rather than about the file, and inventing it would be
inventing biography.

## What the user sees

One line on the career record:

> **Boulot has read your applications** · 44 things you have proven, 16 with
> numbers, 16 worth checking · from 22 applications · updated today

Clicking it shows the file. That is the entire interface.

An earlier version of this feature was a review queue: 35 proposals, each with an
accept button. It was wrong, and it was wrong in a way worth recording. The
point of consolidation is that the system gets better at knowing you without you
doing anything. A queue of 35 chores is the same work moved onto the user with
extra steps, and the first thing anyone does with a 35 item review queue is stop
opening it.

Removing it also removed the "Worth doing" panel that used to sit on the same
page, because consolidation raised the same questions from more evidence, and
two mechanisms giving overlapping advice on one screen is how a page stops being
readable.

## What the agent sees

`profile/MEMORY.md` is appended to the system prompt on every run. Before it
existed, tailoring started from whatever files the agent chose to open, so it
reread the master CV, missed the projects that were never filed there, and
rewrote claims the user had already phrased better six applications ago.

It is injected as system context rather than pasted into the prompt so it caches
across turns, and read fresh each run so an application archived a minute ago is
already reflected.

## Two things found by running it

Both were invisible in review and obvious the moment real data went through.

**Everything looked abandoned.** The "you stopped saying this" check compares a
claim against your most recent applications. The three most recent were a lead
and two drafts with no CV between them, so no claim could appear in any of them,
so all 44 were flagged as dropped and the one finding that mattered was buried.
Recency now only counts applications that produced a CV.

**Small numbers are not results.** Comparing figures flagged "Day 1 was a
WhatsApp group" and "complexity scoring (1-5 by estate value)" as evidence the
record was out of date. A figure now has to carry a unit or be large enough that
nobody writes it incidentally.
