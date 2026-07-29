---
name: outreach
description: Write to a founder or hiring manager at a company with no open role, nudge an application that has gone quiet, or stay warm after a rejection. Use when there is no job description to answer.
---

# Outreach

Every other skill answers a posting. This one is for the case where there is no
posting: a company that raised two to five months ago, needs the person and has
not written the advert yet. No JD to mirror, no CV to tailor against, nobody
else in the queue.

That last part is the whole point. **A cold message competes with nothing.** An
application competes with four hundred.

## Refuse without research

**If `research.md` is missing or thin, stop and say so.** Do not draft.

This is the one skill that could be pointed at three thousand companies and a
send button, and a generically-personalised cold email is worse than no email:
it is the exact thing that makes founders stop reading their inbox, and it
burns the company permanently. The research is not decoration around the
message, it *is* the message. Without it there is nothing true to say.

The bar is one specific, checkable thing about what they are building that
could not be said about a competitor. Not the funding round — everyone leads
with the funding round, and it tells them something they already know better
than you do.

## The shape that works

Four short paragraphs. Under 150 words. It reads like one person wrote it to
one person, because that is the only claim the format itself can make.

1. **The problem, from your side.** Something you hit personally that their
   product exists because of. Not "I'm passionate about X" — the actual
   friction, in one sentence, with the detail that proves you lived it.
2. **What you did about it.** You built something, or you learned something
   the hard way. **Lead with the problem, then reveal you built for it** — the
   reverse order reads as a pitch and gets skimmed past.
3. **What you see in their problem that they have not solved yet.** The
   hardest sentence and the one that earns the reply. It has to be a real
   opinion, and it has to be one they could disagree with.
4. **The ask, small.** Twenty minutes. Not a job — they do not have one, and
   asking for one they have not advertised puts them in the position of saying
   no to be polite.

## What kills these

- **Naming your projects.** "I built clearbook, ward and crux" reads as a
  portfolio dump and invites them to go and judge three things instead of
  replying to one. Describe the work; the names come up on the call.
- **Opening with velocity.** "I ship fast" is what everyone says and it is
  unfalsifiable in an email.
- **Their funding round as the hook.** They know. It reads like a list.
- **A closing flourish.** "Would love to jam" and "excited by what you're
  building" are where the message stops being from a person. End on the ask.
- **Any sentence that would survive being sent to a different company.** Test
  each one: if it would, cut it or make it specific.
- **Length.** Past 150 words the reply rate does not improve, and the message
  starts to look like it took effort you are asking them to reciprocate.

## It is a thread, not a draft

Write into `active/{company}/outreach.md`, and **append rather than replace.**
Each entry:

```markdown
## 2026-07-29 — Sent, to <name>, <how>

<the message as sent>

**Reply:** none yet
```

Update `**Reply:**` when one arrives, in place, with what they said. Never
delete an entry that got no reply — the ones that failed are half the data,
and the point of keeping the thread is that in six months the file can say
which openings actually got answered.

**A nudge is a new entry, not a rewrite.** One nudge, after ten to fourteen
days, and it must carry something new — a thing they shipped, a thing you did.
"Just bumping this" is a second message that says nothing, which is a worse
signal than silence. After that, stop.

## After a rejection

Same file, same rules, one difference: **do not re-apply for the thing you
were rejected for.** The message is about staying in contact with someone who
already spent an hour on you, which is a warmer start than any cold message
gets. It works best when it carries something you have done since.

## When it works

A reply that opens a conversation moves the stage to `screening`, not
`applied` — nothing was applied for. `job.md` may arrive late or never. Say so
in `status.md` rather than inventing an application that did not happen.
