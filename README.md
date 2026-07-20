<div align="center">

# Boulot

**Hiring is run by AI now. Boulot is the one on your side: a free, open-source career system that learns everything you've done and makes you the candidate the bots can't screen out. Runs on your own laptop.**

*Boulot — French slang for "work", "the job", "the daily grind". Free and open source, because the market's hard enough without another subscription.*

[What it is](#what-it-is) · [Why it's different](#why-its-different) · [How to use it](#how-to-use-it) · [Setup](#setup-20-minutes-once) · [Get in touch](#get-in-touch)

</div>

---

## The problem

The job-search tools everyone uses optimise for one thing: **volume**.

- **Auto-apply bots** fire 200 generic applications a day. Reply rates have collapsed *because* of them, and LinkedIn now throttles the accounts that use them.
- **AI recruiter agents** hand you a daily list of often-stale matches. Their incentive is to place you somewhere in *their* network, not to make *you* the strongest candidate for the job *you* want.
- **Trackers and autofill** organise the chaos, but the AI layer is a bolt-on: one-shot, generic, keyword-stuffed text that the latest applicant-tracking systems now actively *penalise*.

All of them share two things: they treat applications as a numbers game, and they keep your career data on their servers.

Boulot is the opposite bet. **Fewer applications, each one much better. Your data stays yours.**

---

## What it is

Boulot is a complete career-ops system that runs on your own computer through [Claude Code](https://claude.com/claude-code). There's no website to log into. It's a set of plain files and AI instructions in a folder you own.

You talk to it in plain English. It:

- **Tailors your CV to each role**, pulling from a master record of everything you've ever done, then rewording and reordering it so the whole thing reads like it was written for that one job. It never invents experience.
- **Argues over your CV before you send it.** Three AI agents with opposing jobs (a Hiring Manager, a Reviewer, and a Strategist) pressure-test every claim and disagree on purpose. You get the version that survived the fight.
- **Researches the company** before you apply or interview: recent news, funding, who you'd report to, any red flags.
- **Drafts cover letters and application answers** that say something only true about *that* company, framed through *your* experience.
- **Grills you for the interview.** A friendly interviewer, a hostile one, and a gap-analyst run a tough mock and tell you exactly where you're bluffing.
- **Tracks every application** and tells you what to do next.

What matters is the craft that goes into each one.

---

## Why it's different

| | Auto-apply bots | AI recruiter agents | Trackers + autofill | **Boulot** |
|---|---|---|---|---|
| **Optimises for** | Volume | Matches in their network | Organisation | **The quality of each application** |
| **Your CV is** | One static PDF, sprayed | A profile in their database | Scored by a bolt-on | **Rebuilt and argued over per role** |
| **Interview prep** | None | Light | Light | **Adversarial mock interviews** |
| **Your data lives** | Their cloud | Their cloud | Their cloud | **On your machine** |
| **Cost** | Monthly subscription | Free, but their incentive ≠ yours | Monthly subscription | **Free & open source** |
| **Gets you in front of people** | Sprays applications | Warm intros (their strength) | No | Researches & surfaces target roles; you decide where to aim |

**What Boulot won't do:** it won't fire off 200 applications while you sleep, and it can't get you a warm introduction to a hiring manager the way a recruiter network can. It does the part they're bad at: taking everything you've done and turning it into an application a bot can't screen past.

---

## How to use it

**First time?** Open the folder in Claude Code and type `/start`. Boulot interviews you one question at a time and writes your profile and master CV from your answers (paste an old CV or your LinkedIn to go faster). That's the only setup.

After that, you just talk to it:

- *"Read my profile and tell me which roles I should go for."*
- *"I want to apply for Head of Operations at Acme. Here's the link."*
- *"Tailor my CV for it."* → the three agents argue, you get the sharpened version.
- *"Make me a PDF."*
- *"Research the company before my interview."*
- *"Grill me for the interview, be tough."*
- *"What's the status of all my applications?"*

There are shortcuts for the big jobs:

| Command | What it does |
|---|---|
| `/start` | First-time setup: interviews you and builds your profile + master CV |
| `/new-job` | Start tracking a role you want to apply for |
| `/apply` | Full application in one go: research + tailored CV + cover letter + tracking |
| `/cv` | Tailor your CV to a role (the three agents argue over it) |
| `/pdf` | Turn a tailored CV into a clean PDF |
| `/research` | Deep-dive a company before you apply or interview |
| `/prep` | Tough interview prep: likely questions, your best answers, your weak spots |
| `/status` | Every active application at a glance |
| `/archive` | File a finished application and capture what you learned |

---

## Setup (20 minutes, once)

You do **not** need to be technical. If you get stuck, paste the error into the AI and ask it to fix it. It's genuinely good at that.

1. **Get a Claude account.** Sign up at [claude.com](https://claude.com) (a paid plan, Pro or Max, for it to do real work).
2. **Install Claude Code.** Follow [the install guide](https://docs.claude.com/claude-code). There's a desktop app (no terminal needed) and a command-line version.
3. **Download Boulot.** Click the green **Code → Download ZIP** button at the top of this page and unzip it. (Or, if you have git: `git clone https://github.com/ElliotJLT/boulot-os.git boulot`.)
4. **(Optional) Turn on CV-to-PDF.** Install [Node.js](https://nodejs.org) (the "LTS" version), then in the `.claude/skills/cv-generator/scripts` folder run `npm install`. Skip this if you don't need PDFs.
5. **Set yourself up.** Open the boulot folder in Claude Code and type `/start`. Boulot interviews you and writes your profile and master CV from your answers. Nothing to fill in by hand.
6. **Apply for your first role.** Paste a job link and say *"tailor my CV for this."* You get a tailored CV, a cover letter, company research, and a mock interview.

The AI itself will walk you through anything that trips you up.

---

## What's in the box

- **`USER/`** — everything about you and your applications (active roles, pipeline, archive, reusable interview stories, reference CVs).
- **`shared/`** — interview frameworks (STAR method, question bank, salary negotiation) and templates, plus an optional script to build a searchable database of target companies from a CSV you provide.
- **`.claude/`** — the system's brain: the AI agents, commands, and rules.
- **`CLAUDE.md`** — the master instructions the AI reads every time.

Your real applications and personal data never leave your machine, and are ignored by git so they're never committed.

---

## Get in touch

I built Boulot for my own job hunt, in a brutal market, because the tools I tried treated me as a list of spam to send. It worked, so I open-sourced it and made it free. It's entirely my own work, and mine to give away.

If you want to use it, want a hand setting it up, or want to talk about building AI that's actually on people's side:

- **Email:** [elliotjlittle@gmail.com](mailto:elliotjlittle@gmail.com)
- **LinkedIn:** [linkedin.com/in/hireelliot](https://www.linkedin.com/in/hireelliot)

---

<div align="center">
<sub>Boulot runs locally through Claude Code. It never sends your data anywhere except to the AI you choose to power it.</sub>
</div>
