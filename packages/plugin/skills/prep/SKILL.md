---
name: prep
description: Prepare for an interview, or run a mock interview. Use when the user has an interview coming up, wants to be grilled, or wants to know what they will be asked and where they are weak.
---

# Interview prep

The document is the deliverable, not the conversation. Everything worth keeping
goes into `active/{company}/prep.md`, because that is what gets read twenty
minutes before the call.

## Gather

Read each thing once:

- `job.md`, `research.md`, and the `cv.md` that was actually sent.
- `cv-master.md` for evidence.
- `references/exemplar-prep.md` if it exists, **for structure only**. Never take
  a fact from it.
- `stories/` if it exists, for reusable STAR stories.
- The candidate's own projects, when the role is in a domain they have built in.
  A side project in the employer's own domain is the strongest thing on the page
  and it is never on the CV.

## How to write it

- **Bullets, not paragraphs.** This is skimmed standing up, with a coat on.
  Prose only where the sentence itself is the deliverable: a drafted answer, a
  line to say out loud.
- **Lead with the answer.** Context after, if at all.
- **Bold the sentence that has to land**, because long documents get skimmed.
- **Every answer lands in 60 to 90 seconds spoken.** Long answers are where
  people lose interviews.
- **Mark anything unverified as unverified.** A guess stated plainly is how a
  claim gets repeated in a room where somebody knows better.

## What goes in it

**Open with what they are actually building.** Not their marketing sentence: the
problem underneath it, why it is technically hard, and what breaks for a user
when it goes wrong. A prep document that opens with likely questions assumes the
candidate already understands the company, and not understanding the company is
how interviews are lost. If you cannot say what is hard about this product in
three sentences, the research is not finished and the rest is guesswork.

Then, in this order:

1. **The thing they will probe** — the biggest gap between the candidate and the
   job description, quoted from the job description where possible, with a
   drafted opening that closes it without arguing.
2. **What the candidate has already built in this domain**, and how to raise it
   without it sounding like a pitch: lead with the problem they hit, then reveal
   they built for it.
3. **The point of view to bring**, ending in the one question that carries it —
   the question that is shop talk if they have an answer and a description of
   the first month if they do not.
4. **Competitors and casualties** — who else tried this and what actually killed
   them, how this company's shape differs, and what that leaves unanswered.
5. **What to ask them.** Four at most, each revealing that the research
   happened. A question that could be asked of any company is worse than none.
6. **The number** — the band, whether it is light for the title, the walk-away
   decided before the call rather than during it, and what to ask about equity.
7. **A technical brief**, only if the job description names something the
   candidate has not used. Plain language, zero assumed knowledge, short
   examples, the one or two questions most likely to be asked, and an honest
   line about their actual level. A specific admission beats a confident wrong
   answer and is the only version that survives contact with someone who has
   done it for a decade.
8. **The "why" answers** for the candidate's own past technical decisions, as
   options to pick from rather than one answer, marking which connect to this
   company's problem.
9. **Method**, where how they work is the selling point rather than what they
   know. Named practices, and including where they do *not* trust the tool.
10. **Facts, checked `<date>`**, with anything unverifiable said so.
11. **Loose ends**, then an empty **My notes** heading at the bottom.

Skip any section that does not apply. A short prep document that is all true
beats a complete one that is padded.

## Answering a single question

When asked one thing rather than for the whole document, answer in the
conversation **and** append it to `prep.md` under a heading of its own. Leave
everything already in that file alone: some of it is the candidate's own
writing, and some of it they have edited on purpose.

If the question quotes a passage from `prep.md`, that passage is the subject.
Edit it in place rather than appending a new section saying the same thing
differently.

## Mock interview

When asked to grill, be genuinely tough, not encouraging. One question at a
time. Interrupt vague answers. Ask "what was the number?" when a claim has none.
Ask the hostile follow-up: "why should we hire you over someone who has actually
done this before?"

Afterwards, be specific about what was weak. "That was good" helps nobody.

## After the interview

Update `prep.md` with what was actually asked and what landed. Update
`status.md` with the new stage and the next action date. That record is what
makes the next application better.
