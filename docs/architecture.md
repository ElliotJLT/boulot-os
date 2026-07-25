# How Boulot is built, and why

Written 2026-07. The point of this document is that most "AI app" architecture
advice is still shaped by 2024 constraints: one model call, a big prompt, a
retry when it comes out wrong. None of those constraints apply now, and building
as though they do produces something expensive and fragile. Every decision below
is recorded with the evidence that drove it, because several of them are the
opposite of what the obvious approach would have been.

---

## 1. Deterministic core, agentic edges

The instinct is to let the model do everything. It is capable enough, so it
feels natural. It is also slow, expensive, and non-deterministic in places where
none of that buys you anything.

The rule here: **if the answer is a pure function of data you already have,
compute it.** Reserve the model for judgment.

Concretely, in this codebase the model does *not* decide:

| Job | Where it lives | Why not the model |
|---|---|---|
| Is this application stale? | `pipeline/flags.ts` | Two dates and a threshold. A model gets boundaries subtly wrong and costs a round trip to do arithmetic. |
| What are my next three actions? | `pipeline/flags.ts` | Sorting. Also enforces the standing "three actions max" rule structurally instead of hoping a prompt remembers it. |
| What is my interview conversion rate? | `learning/funnel.ts` | Counting. |
| Does this CV fit on two pages? | the renderer | Measurable in the browser to the millimetre. |

The model decides what to write, what to cut, what a job description is really
asking for, and whether a claim is honest. Those are the parts that need
judgment, and they are the parts worth paying for.

A useful test: if you can write a unit test for it, it should not be a prompt.

---

## 2. Skills, not prompts

A skill is a folder with a `SKILL.md`: YAML frontmatter carrying a name and
description, then a markdown body of instructions, plus optional scripts.

The mechanism that matters is **progressive disclosure**. Only the name and
description sit in context by default. The body loads when the model decides the
skill is relevant. That inverts the 2024 tradeoff, where every instruction you
wanted available had to be in the system prompt, so more capability meant more
tokens on every single call whether you used it or not.

Practical consequences:

- Capability scales without context cost. Twenty skills cost roughly twenty
  descriptions, not twenty bodies.
- The description is load-bearing. It is the only thing the model sees when
  deciding whether to load the skill, so it should say **when to use this**, not
  just what it is.
- Skills are portable. The same folder runs in Claude Code, in the Agent SDK,
  and in any other host that reads the format. Boulot ships one skill pack used
  by both the app and the CLI, which is why there is no second copy to drift.

### The rule-loading trap

Path-scoped rules (`.claude/rules/*.md` with a `paths:` glob) attach when a
matching file is touched. Verified empirically: ask the model about a rule
without letting it read a matching file and it reports no such instruction; let
it read one and the rule is there.

That is fine for **editing** and wrong for **generating**. If a rule about how to
write cover letters only attaches once a cover letter is touched, it arrives
after the model has decided what to write. Reactive loading is the wrong shape
for generation-time judgment.

So: rules that constrain *how something is produced* belong in the body of the
skill that produces it. Rules that constrain *how an existing file is edited* can
stay path-scoped.

---

## 3. Subagents are for disagreement, not delegation

The common use is division of labour: split a job into parts, farm them out,
staple the results together. That mostly buys latency.

Boulot uses subagents for **pressure-testing**. Tailoring a CV spawns three with
deliberately opposed briefs:

- a Hiring Manager, who scores each bullet 1 to 5 on relevance to the posting
- a Reviewer, who returns only the three highest-impact edits
- a Strategist, who finds bullets in the master CV that are missing from the
  draft and should not be

The doctrine, stated in the original system and worth keeping: **if all three
agree, the exercise failed.** Three agents producing the same answer is three
times the cost for one answer. The value is in the conflict, and the synthesis
step exists to resolve it rather than to concatenate.

This has a direct architectural consequence. Subagents need the `Task` tool. A
security posture that denies `Task` outright also deletes the most distinctive
feature in the product. The two have to be reconciled deliberately rather than
by whichever config was written last.

---

## 4. Loops: three good shapes and one bad one

"Agentic loop" is doing a lot of work as a phrase. The useful distinction is
what the loop is *closing over*.

### The bad one: blind retry

Do the thing, look at the output, decide it is wrong, try again. The model has
no idea how wrong, so each iteration is a guess. This is what the CV generator
did: write a CV, render it, discover it ran to three pages, guess what to cut,
re-render. Three or four rounds was normal.

If your loop ends with the model guessing at a magnitude, you are missing an
instrument, not a better prompt.

### Good shape 1: measure, then act

Replace the verdict with a measurement. The renderer now reports the overflow in
millimetres, the character density of every section, and precisely which lines
fall past the page boundary, so the model makes one correctly sized cut instead
of four guesses. Full write-up in `fit-loop.md`.

The subtlety that took three attempts: the number has to be denominated in
something the actor can spend. "901 characters" measured from dense Skills text
is the wrong currency for a cut that will happen in sparse Experience text.

### Good shape 2: adversarial, then synthesise

Fan out to opposed viewpoints, then reconcile. Bounded, because the number of
viewpoints is fixed in advance. See section 3.

### Good shape 3: verify by reading back

Never trust that a side effect happened because the call returned. The PDF tool
re-reads the file it just wrote and checks the magic bytes and page count before
reporting success, because the previous implementation polled for a non-empty
file, killed the browser, and could report `Written: 294.6KB` for a truncated
PDF.

The general form: an action that reports its own success is not evidence. Read
the artefact.

---

## 5. The tool surface is the security boundary

Prompting a model not to do something is not a control. Removing the tool is.

Two findings from actually testing this, both of which contradict the intuitive
setup:

**`allowedTools` does not restrict anything.** Bare entries auto-approve, and
they shadow the `canUseTool` callback entirely. The SDK emits a named warning
saying so. Only `disallowedTools` removes a tool from the model's surface. An
allow-list read as a security boundary is precisely backwards.

**Denying `Bash` does not close shell access.** The model itself pointed this
out, unprompted: `Monitor` executes shell commands in the same environment.
`Task`, `Workflow` and `ToolSearch` are also doors, the last because it can
surface deferred tools you believed you had excluded. A deny list that stops at
the obvious name is decoration.

What replaced Bash here: purpose-built in-process MCP tools (`boulot_today`,
`boulot_render_pdf`). Each is narrow, each validates its own inputs, and each
is path-jailed to the vault. A dedicated tool also gives the host somewhere to
hook approval, rendering and audit, which an opaque shell string does not.

Trimming the surface from 32 tools to 9 cut the cost of an identical turn from
$0.198 to $0.055, a 72% saving before any prompt tuning. Security and cost point
the same way here, which is unusual and worth taking.

---

## 6. Derive, never ask

The original system asked the user, via the model, to write an `outcome.md` and
update six sections of a `learning.md` on every archived application. Actual
coverage: 4 of 26 for one user, 0 of 11 for the other.

That is not a discipline failure. The bookkeeping falls due immediately after a
rejection, which is the worst possible moment to request structured data entry
from a human.

Everything that funnel was meant to contain is now computed from `status.md`,
which exists for every application because the pipeline cannot function without
it. Conversion rates, median time to close, and presumed-ghosted counts all fall
out of data already on disk.

**Never ask a human to record what the system can observe.** The corollary is
that the tracker must be agent-owned: a board that requires maintenance is a
board that goes stale, and a stale board is worse than none because it is
believed.

---

## 7. Structured output beats parsing prose

The CV renderer parsed LLM-authored markdown at render time. Measured against
real files, 23 of 55 tailored CVs silently lost a header field and 10 lost the
entire contact block, producing a PDF with a name and no way to reach the
candidate, at exit code zero.

Hardening the parser is a losing game when the producer is a model that redraws
the format on every run. Moving the strictness to the producer ends it: the model
emits a validated structure, and a missing contact block becomes a tool error it
fixes in-loop rather than a blank space nobody checks.

Markdown is still written, still readable, still diffable. It is generated from
the structured form rather than parsed into it.

---

## 8. Cost is a product surface

`total_cost_usd` comes back on every result. The user is paying per token, so
they should see it: a running total, a pre-flight estimate for expensive actions
based on observed medians rather than guesses, and a hard budget cap.

This is also a design constraint working backwards. The 72% saving in section 5
came from noticing the cost of a trivial turn and asking why.

---

## Recording the mistakes

Every section above contains at least one thing that was wrong first. The
pattern in all of them is the same: reading the code or the docs produced a
confident wrong answer, and running the thing produced the right one.

- The parser bug was found by re-implementing it and running it over 59 real files
- The `Monitor` shell door was found by asking a model to try
- The wrong-currency character count was found by making the cut and re-rendering
- The path-jail bug was found by watching an agent fail on a valid path
- The rules were nearly deleted on the strength of a badly designed test

Build the instrument, then use it on yourself.
