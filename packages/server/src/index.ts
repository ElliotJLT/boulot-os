import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import {
  readVault,
  buildFunnel,
  flagsFor,
  nextActions,
  readMaster,
  readApplication,
  archiveCandidates,
  runConsolidation,
  readProfile,
  createVault,
  readDetails,
  writeDetails,
  downloadName,
  vaultIsPopulated,
  peopleIn,
  resolveVault,
  resolvePerson,
  writeConfig,
  updateFrontmatter,
  today as todayStr,
  whatWorked,
  reachedInterview,
  findTells,
  activityGrid,
  momentum,
} from "@boulot/core";
import { run } from "./agent.js";
import { costToday } from "./usage.js";

/**
 * The Boulot local server.
 *
 * Everything except the agent bridge works without an API key, on purpose: the
 * board, the CV editor and the PDF preview are most of the app, and none of
 * them should cost anything to open.
 */

/*
 * Mutable, because first run chooses it.
 *
 * Environment variable beats saved config beats the default folder. Reassigned
 * only by /api/setup, which is the one moment the user is telling us where
 * their career actually lives.
 */
let VAULT = resolveVault();
const PORT = Number(process.env.PORT ?? 4319);
/**
 * The CV renderer ships with the app.
 *
 * It used to be resolved out of the user's vault, which meant this repo could
 * not render a CV at all on a clean machine, and meant two copies of the same
 * script drifting apart. That is the four-renderers problem the vault already
 * had, reintroduced one layer up.
 *
 * BOULOT_RENDERER overrides it, for working on the renderer itself.
 */
const RENDERER =
  process.env.BOULOT_RENDERER ?? resolve(import.meta.dirname, "../renderer/render-cv.mjs");

/**
 * How the agent authenticates.
 *
 * Two paths, and neither needs the user to understand the difference:
 *
 *   api-key      ANTHROPIC_API_KEY is set. Billed per token, real costs come
 *                back on every run, and a hard budget cap applies.
 *   subscription No key. The SDK falls back to the Claude Code login on this
 *                machine. Anthropic's current position (paused 15 Jun 2026) is
 *                that "Agent SDK, claude -p, and third-party app usage still
 *                draw from your subscription's usage limits", so this is a
 *                supported path rather than a loophole. Usage counts against
 *                the plan's limits, and per-run cost figures are nominal.
 *
 * Set BOULOT_AUTH=subscription to ignore a key that is present, which is what
 * you want when the key has run out of credit.
 */
const FORCE_SUBSCRIPTION = process.env.BOULOT_AUTH === "subscription";
if (FORCE_SUBSCRIPTION) delete process.env.ANTHROPIC_API_KEY;
const AUTH_MODE = process.env.ANTHROPIC_API_KEY ? "api-key" : "subscription";

const app = Fastify({ logger: false });

/**
 * Whose vault this is.
 *
 * BOULOT_PERSON pins it to one folder. The vault format supports several
 * people, but the app is for one: a switcher between two careers is a feature
 * nobody asked for and a way to write into the wrong person's files.
 */
let PERSON = resolvePerson();

function people(vault: string): string[] {
  if (PERSON) return existsSync(join(vault, PERSON)) ? [PERSON] : [];
  return peopleIn(vault);
}

/** Everyone in the vault, ignoring the pin. Used by setup to offer a choice. */
function allPeople(vault: string): string[] {
  return peopleIn(vault);
}

/** A vault folder name, written the way a person would read it. */
function displayPerson(who: string): string {
  return who
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Resolve a vault path from untrusted segments, or throw. */
function inVault(...segments: string[]): string {
  const abs = resolve(VAULT, ...segments);
  const rel = relative(VAULT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes the vault");
  return abs;
}

/*
 * What today has cost, across every application.
 *
 * Not person-scoped, because the log is not either: one machine, one running
 * total for the day, which is what "should I keep going" actually needs to
 * know. Polled rather than pushed — a run finishing is not urgent enough to
 * justify a socket message just for this.
 */
app.get("/api/cost/today", async () => costToday());

app.get("/api/health", async () => {
  const who = people(VAULT);
  /*
   * `needsSetup` exists so the UI never has to infer it from an empty list.
   *
   * There are two distinct empty states and they need different screens: no
   * vault at all, and a vault whose master CV is still the starter template.
   * Both used to render "No vault at /Users/you/Boulot" and stop.
   */
  const populated = who.filter((p) => vaultIsPopulated(join(VAULT, p)));
  return {
    ok: true,
    vault: VAULT,
    vaultExists: existsSync(VAULT),
    people: who,
    needsSetup: who.length === 0 ? "vault" : populated.length === 0 ? "import" : null,
    firstPerson: who[0] ?? null,
    authMode: AUTH_MODE,
    rendererFound: existsSync(RENDERER),
  };
});

/**
 * First run: either point at a folder that already exists, or make one.
 *
 * Both paths end the same way, with the choice saved so it never has to be made
 * again. `boulot` on its own then opens the right career, which is the only
 * acceptable behaviour for a command someone runs every day.
 */
app.post<{ Body: { name?: string; path?: string; person?: string } }>(
  "/api/setup",
  async (req, reply) => {
    const { name, path: existing, person } = req.body ?? {};

    // "I already have one." Validate before saving: a config pointing at
    // nothing is harder to recover from than no config at all.
    if (typeof existing === "string" && existing.trim()) {
      const dir = resolve(existing.trim().replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
      if (!existsSync(dir)) return reply.code(400).send({ error: `No folder at ${dir}` });
      const found = allPeople(dir);
      if (!found.length) {
        return reply
          .code(400)
          .send({ error: `${dir} has no Boulot folders in it. Look for one containing an "active" folder.` });
      }
      // Only ask which person when the answer is genuinely ambiguous.
      if (found.length > 1 && !person) return { needsPerson: found, vault: dir };
      const chosen = person && found.includes(person) ? person : found[0]!;
      VAULT = dir;
      PERSON = chosen;
      writeConfig({ vault: dir, person: chosen });
      return { vault: dir, person: chosen, existed: true };
    }

    const trimmed = (name ?? "").trim();
    if (!trimmed) return reply.code(400).send({ error: "name required" });
    if (trimmed.length > 80) return reply.code(400).send({ error: "name too long" });
    const r = createVault(VAULT, trimmed);
    const who = r.personDir.split("/").pop() ?? null;
    PERSON = who;
    writeConfig({ vault: VAULT, person: who });
    return { ...r, person: who };
  },
);

/** The master CV, read as a record: entries, tags, and what actually gets used. */
app.get<{ Params: { who: string } }>("/api/:who/master", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
  // Cross bullet usage with what actually happened to those applications.
  const { applications } = readVault(dir);
  const reachedSet = new Set<string>();
  const rejected = new Set<string>();
  for (const a of applications) {
    if (reachedInterview(a)) reachedSet.add(a.slug);
    else if (a.stage === "closed-lost") rejected.add(a.slug);
  }
  const m = readMaster(dir, { reachedInterview: reachedSet, rejected });
  if (!m) return reply.code(404).send({ error: "no cv-master.md" });
  /*
   * What has worked, from the sent CVs themselves.
   *
   * Computed here, on the same parse the agent's memory uses, so the page and
   * the prompt can never show different numbers for the same fact.
   */
  const works = whatWorked(dir, applications);
  return { ...m, works, profile: readProfile(dir) };
});

/**
 * The block at the top of every CV, and the name on the file you send.
 *
 * Kept in profile.md rather than in a settings store, so the file still reads
 * as a document and the app is not the only thing that can understand it.
 */
app.get<{ Params: { who: string } }>("/api/:who/details", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
  return readDetails(dir);
});

app.put<{ Params: { who: string }; Body: Record<string, string> }>(
  "/api/:who/details",
  async (req, reply) => {
    const dir = join(VAULT, req.params.who);
    if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
    const allowed = ["name", "headline", "email", "phone", "linkedin", "github", "location", "filename"];
    const patch: Record<string, string> = {};
    for (const k of allowed) {
      const v = req.body?.[k];
      // Length-capped: these become a filename and a line on a CV, and neither
      // has a sensible reason to be enormous.
      if (typeof v === "string" && v.length <= 200) patch[k] = v.trim();
    }
    return writeDetails(dir, patch);
  },
);

/** The consolidated memory, as the agent sees it. */
app.get<{ Params: { who: string } }>("/api/:who/profile", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
  return readProfile(dir) ?? { markdown: "", updated: null };
});

/**
 * Rebuild it now.
 *
 * Exposed because a first run needs a way to happen, not because it is a thing
 * to press. The real trigger is archiving, below.
 */
app.post<{ Params: { who: string } }>("/api/:who/profile", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
  // Folder names are keys ("ELLIOT"); the file is read by a person.
  const r = runConsolidation(dir, displayPerson(req.params.who));
  return r ?? reply.code(404).send({ error: "no cv-master.md to consolidate" });
});

app.get<{ Params: { who: string } }>("/api/:who/board", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
  const { applications, skipped } = readVault(dir);
  const today = new Date();
  return {
    person: req.params.who,
    applications: applications.map((a) => ({ ...a, flags2: flagsFor(a, today) })),
    /*
     * Live applications only.
     *
     * Screenshotting the board caught this: the three most prominent items on
     * the page were Tracebit, Runware and Jack & Jill, all "155d overdue", and
     * none of them were on the board at all. They were archived, and an archived
     * application is overdue forever because nothing will ever update it again.
     *
     * The funnel below deliberately keeps reading everything, because history is
     * where its numbers come from. A to-do list is the opposite: it should only
     * ever contain things you can still act on.
     */
    nextActions: nextActions(applications.filter((a) => a.bucket === "active"), today).map(({ app: a, flag }) => ({
      slug: a.slug,
      company: a.company,
      role: a.role,
      flag,
    })),
    funnel: buildFunnel(applications, today),
    /*
     * What you did, by day, and the few counts worth seeing without asking.
     *
     * Reads the whole vault including the archive, the same as the funnel and
     * for the same reason: this is history, and an application does not stop
     * having been sent on a Tuesday because it was rejected in June.
     */
    activity: (() => {
      const grid = activityGrid(applications, 182, today);
      return { grid, momentum: momentum(grid) };
    })(),
    // Proposed, not performed. The board shows a single line offering the move
    // rather than doing it, because an application that vanishes on its own is
    // worse than one that lingers a fortnight.
    archivable: archiveCandidates(applications, today),
    archived: applications.filter((a) => a.bucket === "archive").length,
    skipped,
  };
});

/**
 * Move an application out of the way.
 *
 * A folder move plus a frontmatter patch, in that order, and nothing is
 * deleted. `archive/` is read by the funnel and the career record, so archiving
 * is filing rather than forgetting: the numbers that tell you what is working
 * come almost entirely from applications that already ended.
 */
app.post<{ Params: { who: string; slug: string }; Body: { outcome?: string; notes?: string } }>(
  "/api/:who/job/:slug/archive",
  async (req, reply) => {
    const { who, slug } = req.params;
    let from: string, to: string;
    try {
      from = inVault(who, "active", slug);
      to = inVault(who, "archive", slug);
    } catch {
      return reply.code(400).send({ error: "bad path" });
    }
    if (!existsSync(from)) return reply.code(404).send({ error: "not in active" });

    /*
     * A folder of the same name can already sit in `archive/`. This is not
     * hypothetical: the vault this was built against has `archive/gradient-labs`
     * holding a single stray research.md while the real application lives in
     * `active/gradient-labs`. Refusing the move looked correct and was the worst
     * option available, because the card then stays on the board forever, which
     * is the entire bug being fixed.
     *
     * So merge. The active copy is the one you were working on, so it wins on a
     * name clash, and the file it displaces is kept beside it rather than
     * overwritten. Nothing is deleted by an archive operation, ever.
     */
    const merged: string[] = [];
    if (existsSync(to)) {
      for (const name of readdirSync(from)) {
        const target = join(to, name);
        if (existsSync(target)) {
          const dot = name.lastIndexOf(".");
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : "";
          renameSync(target, join(to, `${stem}.superseded${ext}`));
          merged.push(name);
        }
        renameSync(join(from, name), target);
      }
      rmSync(from, { recursive: true });
    } else {
      renameSync(from, to);
    }

    // Record the outcome after the move, so a failed write leaves a filed
    // application with stale frontmatter rather than a half-moved folder.
    /*
     * What you learned, written where it will be read again.
     *
     * The outcome alone is a tally: five rejections is a number, not a lesson.
     * The thing worth keeping is the sentence you can only write in the hour
     * after a rejection, and if there is nowhere to put it then it is thought
     * once and lost.
     *
     * Two places, deliberately. `outcome.md` beside the application is the
     * record of this one, company-specific and permanent. `profile/outcomes.md`
     * is the running log the agent reads before writing anything, so a pattern
     * across five rejections is visible to the thing doing the writing rather
     * than only to the person doing the remembering.
     */
    const notes = (req.body?.notes ?? "").trim();
    if (notes) {
      const app = existsSync(join(to, "status.md"))
        ? readApplication(join(to, "status.md"), slug, "archive")
        : null;
      const who_ = app?.company ?? slug;
      const outcome = req.body?.outcome ?? "unrecorded";
      writeFileSync(
        join(to, "outcome.md"),
        `---\ntype: outcome\ncompany: ${who_}\noutcome: ${outcome}\ndate: ${todayStr()}\n---\n\n` +
          `# ${who_} — what happened\n\n${notes}\n`,
      );
      const log = join(VAULT, who, "profile", "outcomes.md");
      mkdirSync(dirname(log), { recursive: true });
      const header = existsSync(log)
        ? ""
        : "# Outcomes\n\nWhat happened, and what was learned. Written when an application is " +
          "archived.\nRead before writing anything: a pattern across several of these is worth " +
          "more than\nany single one.\n";
      appendFileSync(log, `${header}\n## ${who_} — ${outcome} — ${todayStr()}\n\n${notes}\n`);
    }

    const status = join(to, "status.md");
    if (existsSync(status) && req.body?.outcome) {
      const outcome = req.body.outcome;
      const won = outcome === "offer_accepted";
      writeFileSync(
        status,
        updateFrontmatter(readFileSync(status, "utf8"), {
          stage: won ? "accepted" : outcome === "ghosted" ? "ghosted" : outcome,
          outcome,
          last_updated: todayStr(),
          next_action: null,
          next_action_date: null,
        }),
      );
    }
    /*
     * Consolidate on archive.
     *
     * This is the trigger. autoDream waits for elapsed time and a session count
     * because sessions are its unit of work; here the unit of work is an
     * application, and one finishing is an unambiguous signal that there is
     * something new to learn and nothing left to wait for. It costs nothing and
     * takes milliseconds, so it happens inline rather than being queued.
     */
    const consolidated = runConsolidation(join(VAULT, who), displayPerson(who));

    return {
      archived: slug,
      merged,
      noted: Boolean(notes),
      memory: consolidated?.summary ?? null,
      application: readApplication(status, slug, "archive"),
    };
  },
);

/**
 * Move an application to another stage.
 *
 * What dragging a card writes. Only the three stages the board actually shows
 * are accepted, so a drag can never put a record into a state the UI cannot
 * then display.
 */
/*
 * When the interview is.
 *
 * Its own endpoint rather than a field on the stage change, because the two
 * happen at different moments: the stage moves when they reply, the date
 * arrives in a later email, and often from a calendar invite rather than a
 * sentence.
 */
app.post<{ Params: { who: string; slug: string }; Body: { date?: string | null } }>(
  "/api/:who/job/:slug/interview-date",
  async (req, reply) => {
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    const status = join(dir, "status.md");
    if (!existsSync(status)) return reply.code(404).send({ error: "no status.md" });
    const date = (req.body?.date ?? "").trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: "date must be YYYY-MM-DD or empty" });
    }
    writeFileSync(
      status,
      updateFrontmatter(readFileSync(status, "utf8"), {
        interview_date: date || null,
        last_updated: todayStr(),
      }),
    );
    return { slug: req.params.slug, interviewDate: date || null };
  },
);

/*
 * What the company is called.
 *
 * Recruiters withhold the client, so an application often starts life as
 * "Unknown (recruiter-anonymized UK fintech, lending)" and stays that way
 * after they tell you who it is. Asking the agent to rename it is the obvious
 * move and the wrong tool: told "change the name to X" with a CV in context,
 * it find-and-replaced a real past employer throughout the CV and the cover
 * letter, which is a factual error on a document that gets sent to people.
 *
 * So renaming is a plain field edit the user does directly. The folder name
 * never changes: it is the identity every other file and every running job
 * refers to, and renaming directories under an app that has the old path open
 * is a much bigger promise than this needs to make.
 */
app.post<{ Params: { who: string; slug: string }; Body: { company?: string } }>(
  "/api/:who/job/:slug/company",
  async (req, reply) => {
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    const status = join(dir, "status.md");
    if (!existsSync(status)) return reply.code(404).send({ error: "no status.md" });
    const company = (req.body?.company ?? "").trim();
    if (!company) return reply.code(400).send({ error: "company required" });
    writeFileSync(
      status,
      updateFrontmatter(readFileSync(status, "utf8"), {
        company,
        last_updated: todayStr(),
      }),
    );
    return { slug: req.params.slug, company };
  },
);

app.post<{ Params: { who: string; slug: string }; Body: { stage?: string } }>(
  "/api/:who/job/:slug/stage",
  async (req, reply) => {
    const stage = req.body?.stage;
    /*
     * Only what a column can mean.
     *
     * "closed" is gone with the column that wrote it: the board knew an
     * application had ended and never knew how, so it wrote closed-lost and
     * put a guess into the funnel. Archive asks.
     */
    const ALLOWED: Record<string, string> = {
      drafting: "drafting",
      applied: "applied",
      interviewing: "interviewing",
    };
    const value = stage ? ALLOWED[stage] : undefined;
    if (!value) return reply.code(400).send({ error: "unknown stage" });

    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    const status = join(dir, "status.md");
    if (!existsSync(status)) return reply.code(404).send({ error: "no status.md" });

    /*
     * Moving into Applied is the moment you applied.
     *
     * Without a date the funnel cannot say how long anything took, and asking
     * someone to type it is the bookkeeping this app exists to avoid. Only set
     * when it is missing: a card dragged out and back should not have its
     * history rewritten to today.
     */
    const before = readFileSync(status, "utf8");
    /*
     * Horizontal whitespace only.
     *
     * `\s` matches newlines, so `applied_date:` with nothing after it matched
     * the first non-space character of the *next* line and the check concluded
     * a date was already recorded. Marking an application as applied then set
     * the stage and silently left the date blank, which is the one field the
     * whole funnel measures from.
     */
    const hasApplied = /^applied_date:[^\S\n]*\S/m.test(before);
    writeFileSync(
      status,
      updateFrontmatter(before, {
        stage: value,
        last_updated: todayStr(),
        // When the stage moved, which is what "Interviewing since" measures
        // from. last_updated moves whenever a document is saved.
        stage_changed: todayStr(),
        ...(value === "applied" && !hasApplied ? { applied_date: todayStr() } : {}),
      }),
    );
    /*
     * Reaching Interviewing starts the preparation.
     *
     * The moment they reply is when there is most to find out and least chance
     * of anyone sitting down to find it. A first draft that exists beats a
     * better one you have to remember to ask for.
     *
     * Server-side rather than in the board, so dragging a card and using the
     * status menu behave the same way. Only when there is no prep document yet,
     * so moving a card back and forth cannot overwrite notes already written.
     */
    if (value === "interviewing" && !existsSync(join(dir, "prep.md"))) {
      const app = readApplication(status, req.params.slug);
      startRun({
        prompt:
          `Use the boulot:prep skill to write the first draft of active/${req.params.slug}/prep.md. ` +
          `They have replied and an interview is coming. Follow the skill's section order and skip ` +
          `any section you cannot fill honestly. Do not edit cv.md, cover-letter.md or ` +
          `application-answers.md: the employer already has them.`,
        person: req.params.who,
        job: req.params.slug,
        slug: req.params.slug,
        company: app.company ?? req.params.slug,
        label: "Preparing for the interview",
        model: "claude-opus-4-8",
      });
    }

    return { slug: req.params.slug, stage: value };
  },
);

/**
 * Start the writing again, keeping what was expensive to get.
 *
 * The job description and the research cost web searches and minutes; the CV,
 * the letter and the answers are the parts you actually want re-done when a
 * draft has gone wrong. Deleting only the outputs means a reset is cheap and
 * repeatable, which is the difference between trying again and starting over.
 */
app.post<{ Params: { who: string; slug: string } }>(
  "/api/:who/job/:slug/reset",
  async (req, reply) => {
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });

    // Everything here is regenerable. job.md, research.md and status.md are not
    // touched: they are the inputs, not the output.
    const OUTPUTS = ["cv.md", "cover-letter.md", "application-answers.md", "prep.md", "cv.pdf", "cv.fit.json", "cv.html"];
    const removed: string[] = [];
    for (const f of OUTPUTS) {
      const path = join(dir, f);
      if (!existsSync(path)) continue;
      rmSync(path, { force: true });
      removed.push(f);
    }
    return { reset: req.params.slug, removed };
  },
);

/** Put one back. Archiving is reversible or it is a trapdoor. */
app.post<{ Params: { who: string; slug: string } }>(
  "/api/:who/job/:slug/restore",
  async (req, reply) => {
    const { who, slug } = req.params;
    let from: string, to: string;
    try {
      from = inVault(who, "archive", slug);
      to = inVault(who, "active", slug);
    } catch {
      return reply.code(400).send({ error: "bad path" });
    }
    if (!existsSync(from)) return reply.code(404).send({ error: "not in archive" });
    if (existsSync(to)) return reply.code(409).send({ error: "already active" });

    renameSync(from, to);
    const status = join(to, "status.md");
    if (existsSync(status)) {
      writeFileSync(
        status,
        updateFrontmatter(readFileSync(status, "utf8"), {
          stage: "applied",
          outcome: null,
          last_updated: todayStr(),
        }),
      );
    }
    return { restored: slug };
  },
);

/**
 * The documents that make up an application.
 *
 * Named rather than freeform: an application is a CV, a cover letter and a set
 * of application questions, and the UI shows those three as a checklist so the
 * user can see what exists and what does not.
 */
const DOCS = {
  cv: { file: "cv.md", label: "Tailored CV" },
  cover: { file: "cover-letter.md", label: "Cover letter" },
  questions: { file: "application-answers.md", label: "Application questions" },
  prep: { file: "prep.md", label: "Prep" },
  job: { file: "job.md", label: "Job description" },
  research: { file: "research.md", label: "Research" },
  /*
   * The one document that is not about a job.
   *
   * Everything above answers a posting. This one exists because the best time
   * to reach a company is before the posting exists: two to five months after
   * a raise, when the need is real and the advert is not written. There is no
   * JD to mirror and no CV to tailor against, so the message has to be about
   * their problem — which is the only kind of cold email that has ever worked.
   *
   * It is a thread rather than a draft. A CV is written once and sent; this is
   * sent, ignored, nudged, and eventually answered, and what matters later is
   * which openings got replies. So it accumulates dated entries and is never
   * rewritten in place.
   */
  outreach: { file: "outreach.md", label: "Outreach" },
} as const;
type DocKey = keyof typeof DOCS;

/*
 * Tabs you make yourself.
 *
 * The fixed six carry an application from posting to interview, and then stop.
 * A process that goes further — a second round, a take-home, a panel — has
 * documents nobody could have named in advance, and the alternative to making
 * them here is a folder of markdown the app cannot see.
 *
 * Stored as plain files beside the others, named from what you called the tab,
 * so they read without this app and the agent can be pointed at them by name.
 */
const RESERVED = new Set([
  ...Object.values(DOCS).map((d) => d.file),
  "status.md",
  "outcome.md",
  "conversation.md",
  "cv.fit.json",
  "cv.html",
]);

/** A tab name to a filename: lowercase, hyphens, nothing that escapes a folder. */
function docSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
}

/** The title a custom document carries, so renaming happens in the file. */
function titleOf(path: string, fallback: string): string {
  try {
    const text = readFileSync(path, "utf8");
    return (
      /^title:\s*(.+)$/m.exec(text)?.[1]?.trim() ||
      /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ||
      fallback
    );
  } catch {
    return fallback;
  }
}

/** Every custom document in an application folder, in creation order. */
function customDocs(dir: string): Array<{ key: string; label: string; file: string; exists: true }> {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !RESERVED.has(f))
      .map((f) => ({ f, at: statSync(join(dir, f)).birthtimeMs || statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => a.at - b.at)
      .map(({ f }) => {
        const key = f.replace(/\.md$/, "");
        return {
          key,
          label: titleOf(join(dir, f), key.replace(/-/g, " ")),
          file: f,
          exists: true as const,
        };
      });
  } catch {
    return [];
  }
}

/** Resolve a document key to a filename, fixed or custom. */
function docFile(key: string): string | null {
  const fixed = (DOCS as Record<string, { file: string } | undefined>)[key];
  if (fixed) return fixed.file;
  const slug = docSlug(key);
  return slug && !RESERVED.has(`${slug}.md`) ? `${slug}.md` : null;
}

function jobDir(who: string, slug: string): string | null {
  for (const bucket of ["active", "archive"]) {
    try {
      const dir = inVault(who, bucket, slug);
      if (existsSync(dir)) return dir;
    } catch {
      /* outside the vault */
    }
  }
  return null;
}

/** Which deliverables exist, plus the fit report if there is one. */
/**
 * The rendered CV, whatever it is called.
 *
 * The app writes cv.pdf. The vault this app grew out of wrote "Elliot Little -
 * Clera - Founding Product Engineer.pdf", and twenty-one folders still carry
 * that convention, so every one of them looked to the app like an application
 * whose PDF had never been rendered: no PDF tab, an unticked step, and a Start
 * over as the only apparent way forward.
 *
 * Renaming twenty-one files someone has already sent to employers is not a fix.
 * Looking for the file is. cv.pdf wins when it exists, because that is what a
 * fresh render produces; otherwise the newest PDF in the folder is the CV,
 * since nothing else in an application folder is a PDF.
 */
function findPdf(dir: string): string | null {
  if (existsSync(join(dir, "cv.pdf"))) return "cv.pdf";
  try {
    const pdfs = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    return pdfs[0]?.f ?? null;
  } catch {
    return null;
  }
}

app.get<{ Params: { who: string; slug: string } }>("/api/:who/job/:slug/docs", async (req, reply) => {
  const dir = jobDir(req.params.who, req.params.slug);
  if (!dir) return reply.code(404).send({ error: "no such application" });
  const fitPath = join(dir, "cv.fit.json");
  return {
    docs: Object.entries(DOCS).map(([key, d]) => {
      const p = join(dir, d.file);
      const exists = existsSync(p);
      return { key, label: d.label, file: d.file, exists, chars: exists ? readFileSync(p, "utf8").length : 0 };
    }),
    // Tabs the user made, discovered from the folder rather than from a list.
    extra: customDocs(dir).map((d) => ({
      ...d,
      chars: readFileSync(join(dir, d.file), "utf8").length,
    })),
    pdf: findPdf(dir),
    downloadName: (() => {
      const status = join(dir, "status.md");
      const a = existsSync(status) ? readApplication(status, req.params.slug) : null;
      return downloadName(readDetails(join(VAULT, req.params.who)), {
        role: a?.role,
        company: a?.company,
      });
    })(),
    // The workbench needs it to know whether to offer "Mark as applied".
    stage: existsSync(join(dir, "status.md")) ? readApplication(join(dir, "status.md")).stage : null,
    // And when, so it can say so rather than making you go and look.
    appliedDate: existsSync(join(dir, "status.md"))
      ? (readApplication(join(dir, "status.md")).appliedDate ?? null)
      : null,
    interviewDate: existsSync(join(dir, "status.md"))
      ? (readApplication(join(dir, "status.md")).interviewDate ?? null)
      : null,
    fit: existsSync(fitPath) ? JSON.parse(readFileSync(fitPath, "utf8")) : null,
    /*
     * Machine-checkable writing tells, for the documents made of prose.
     *
     * The CV gets measured for overflow and for whether a parser can read it.
     * The documents a human actually sits and reads got nothing, and an answer
     * went out carrying the exact construction the voice rules ban by name.
     * Same treatment: computed here, reported plainly, no model in the loop.
     *
     * Not the CV, whose bullets are deliberately clipped and would read as
     * false positives, and not the job description or research, which are
     * somebody else's prose.
     */
    tells: Object.fromEntries(
      (["cover", "questions"] as const).flatMap((key) => {
        const p = join(dir, DOCS[key].file);
        if (!existsSync(p)) return [];
        const found = findTells(readFileSync(p, "utf8"));
        return found.length ? [[key, found]] : [];
      }),
    ),
  };
});

app.get<{ Params: { who: string; slug: string; doc: string } }>(
  "/api/:who/job/:slug/doc/:doc",
  async (req, reply) => {
    const file = docFile(req.params.doc);
    if (!file) return reply.code(400).send({ error: "unknown document" });
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    const p = join(dir, file);
    return { markdown: existsSync(p) ? readFileSync(p, "utf8") : "", exists: existsSync(p) };
  },
);

app.put<{ Params: { who: string; slug: string; doc: string }; Body: { markdown: string } }>(
  "/api/:who/job/:slug/doc/:doc",
  async (req, reply) => {
    const file = docFile(req.params.doc);
    if (!file) return reply.code(400).send({ error: "unknown document" });
    if (typeof req.body?.markdown !== "string") return reply.code(400).send({ error: "markdown required" });
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    writeFileSync(join(dir, file), req.body.markdown);
    return { saved: true };
  },
);

/*
 * Deleting a tab means deleting the file. There is no trash: it is a markdown
 * file in a folder the user already owns, and pretending to remove it while
 * keeping it around somewhere is the kind of surprise that erodes trust in
 * every other "gone" in the app.
 *
 * Restricted to tabs the user made. cv.md, job.md, prep.md and the rest are
 * structural — the app has other, considered ways to clear them (Start over,
 * dropping a step before a run) — and a blanket delete-by-key route would let
 * any of them go the same way a stale round does.
 */
app.delete<{ Params: { who: string; slug: string; doc: string } }>(
  "/api/:who/job/:slug/doc/:doc",
  async (req, reply) => {
    if (req.params.doc in DOCS) return reply.code(400).send({ error: "not a removable tab" });
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    const file = docFile(req.params.doc);
    if (!file || RESERVED.has(file)) return reply.code(400).send({ error: "not a removable tab" });
    const p = join(dir, file);
    if (!existsSync(p)) return reply.code(404).send({ error: "no such document" });
    rmSync(p);
    return { ok: true };
  },
);

/*
 * A new tab, which is a new file.
 *
 * Created with its title as the first line, so the name lives in the document
 * rather than in a registry the file knows nothing about. Rename the heading
 * and the tab follows.
 */
app.post<{ Params: { who: string; slug: string }; Body: { name?: string } }>(
  "/api/:who/job/:slug/doc",
  async (req, reply) => {
    const name = (req.body?.name ?? "").trim();
    const key = docSlug(name);
    if (!name || !key) return reply.code(400).send({ error: "name required" });
    if (RESERVED.has(`${key}.md`)) return reply.code(409).send({ error: "that name is taken" });
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    const path = join(dir, `${key}.md`);
    if (existsSync(path)) return { key, label: titleOf(path, name), existed: true };
    writeFileSync(path, `# ${name}\n\n`);

    /*
     * A named round is the record that the round exists.
     *
     * substage has been in the schema since the beginning, meant for exactly
     * this — "Round 2", "In-office task day" — and nothing has ever written to
     * it. Making a tab called "Round 2 task" is the moment that fact becomes
     * true, and it is the only moment anybody would ever have typed it in.
     * Asking separately would be asking a person to record what the system just
     * watched them do.
     */
    const status = join(dir, "status.md");
    if (existsSync(status)) {
      const app = readApplication(status, req.params.slug);
      if (["screening", "interviewing", "offer"].includes(app.stage)) {
        writeFileSync(
          status,
          updateFrontmatter(readFileSync(status, "utf8"), {
            substage: name,
            // The old date belonged to the round that has just been superseded.
            interview_date: null,
            last_updated: todayStr(),
          }),
        );
      }
    }

    return { key, label: name, existed: false };
  },
);

/** Render, and return the fit report so the UI can show whether it fits. */
app.post<{ Params: { who: string; slug: string } }>("/api/:who/job/:slug/pdf", async (req, reply) => {
  const { who, slug } = req.params;
  const { spawnSync } = await import("node:child_process");
  for (const bucket of ["active", "archive"]) {
    const dir = join(VAULT, who, bucket, slug);
    const cv = join(dir, "cv.md");
    if (!existsSync(cv)) continue;
    const out = join(dir, "cv.pdf");
    const r = spawnSync("node", [RENDERER, cv, out], { encoding: "utf8", timeout: 120_000 });
    const fitPath = join(dir, "cv.fit.json");
    return {
      status: r.status,
      fits: r.status === 0,
      badHeader: r.status === 2,
      output: `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-4000),
      fit: existsSync(fitPath) ? JSON.parse(readFileSync(fitPath, "utf8")) : null,
      pdf: findPdf(dir),
    };
  }
  return reply.code(404).send({ error: "no cv.md" });
});

app.get<{ Params: { who: string; slug: string; file: string } }>(
  "/api/:who/job/:slug/file/:file",
  async (req, reply) => {
    const { who, slug, file } = req.params;
    for (const bucket of ["active", "archive"]) {
      try {
        const p = inVault(who, bucket, slug, file);
        if (!existsSync(p)) continue;
        return reply.type(file.endsWith(".pdf") ? "application/pdf" : "text/plain").send(readFileSync(p));
      } catch {
        /* fall through */
      }
    }
    return reply.code(404).send({ error: "not found" });
  },
);

/*
 * Where the built interface lives.
 *
 * Relative-to-source by default, which is right in the repo and wrong in the
 * desktop bundle, where the server is one bundled file sitting beside its
 * assets rather than three directories deep. The bundle sets BOULOT_WEB rather
 * than the layout being guessed at from __dirname.
 */
const webDist = process.env.BOULOT_WEB ?? resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"),
  );
}

/** What is running, so a screen that just opened can catch up rather than guess. */
app.get("/api/jobs", async () => ({
  max: MAX_CONCURRENT,
  jobs: [...jobs.values()].map((j) => ({
    id: j.id,
    slug: j.slug,
    company: j.company,
    role: j.role,
    label: j.label,
    running: j.running,
    startedAt: j.startedAt,
    events: j.events,
  })),
}));


const address = await app.listen({ port: PORT, host: "127.0.0.1" });

/** Agent bridge. One socket per run; the client sends a prompt, we stream back. */
const wss = new WebSocketServer({ server: app.server, path: "/ws" });
/**
 * Runs are owned by the server, not by the tab that started them.
 *
 * Two things follow from that, and both were asked for.
 *
 * Leaving the page does not cancel the work. It never did, because the agent
 * writes to the vault rather than to the socket, but the narration was lost the
 * moment you navigated away, so a run you walked back to looked like it had
 * stopped. Every event is now kept, so a screen that arrives late can catch up.
 *
 * And more than one application can be built at once. The cap is three: the
 * limit is not the machine, it is that each run costs tokens and reads the same
 * vault, and a person who has started five is no longer supervising any of them.
 */
const MAX_CONCURRENT = 3;

interface Job {
  id: string;
  /** Application folder, once it is known. New applications learn it mid-run. */
  slug: string | null;
  /** Who it is for, as well as we currently know. Improves as the run goes. */
  company: string | null;
  role: string | null;
  label: string;
  events: unknown[];
  running: boolean;
  startedAt: number;
  /*
   * One conversation per application, not per tab.
   *
   * The agent resumes its own session so a tweak remembers the CV it just
   * wrote. That used to be keyed to the websocket, which was survivable when
   * only one thing could run and actively wrong the moment three could: three
   * applications sharing a tab would have shared a conversation, and one
   * company's job description would have been in context while another's CV
   * was written. Keying it to the application is what makes concurrency safe.
   */
  sessionId?: string | undefined;
}

const jobs = new Map<string, Job>();
const sockets = new Set<import("ws").WebSocket>();

function broadcast(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const s of sockets) {
    try {
      if (s.readyState === s.OPEN) s.send(text);
    } catch {
      /* that tab went away; the run continues and the vault is still written */
    }
  }
}

const activeJobs = () => [...jobs.values()].filter((j) => j.running);

wss.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));

  socket.on("message", async (raw) => {
    let msg: Ask;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg.prompt || !msg.person) return;

    const refused = startRun(msg);
    if (refused) socket.send(JSON.stringify({ t: "error", job: msg.job, message: refused }));
  });
});

/** What a run needs, whether it was asked for over the socket or over HTTP. */
interface Ask {
  prompt?: string;
  person?: string;
  job?: string;
  label?: string;
  slug?: string;
  company?: string;
  model?: string;
  /** What the user actually asked, in their words, for the record. */
  note?: string;
}

/*
 * Starting a run, from anywhere.
 *
 * This lived inside the websocket handler, which meant the only way to begin
 * work was for a browser tab to ask for it. Moving a card to Interviewing has
 * to be able to start the preparation too, and that decision is made on the
 * server. Returns a refusal string, or null when the run is away.
 */
function startRun(msg: Ask): string | null {
  {
    // Checked by every caller, restated here so the closure below has a string.
    const prompt = msg.prompt;
    const person = msg.person;
    if (!prompt || !person) return "Nothing to do.";

    const id = msg.job ?? `job-${Date.now()}`;
    const existing = jobs.get(id);
    if (existing?.running) return "That application is already running.";
    if (activeJobs().length >= MAX_CONCURRENT) {
      return "Three applications are already running. Wait for one to finish.";
    }

    const previous = jobs.get(id);
    const job: Job = {
      id,
      ...(previous?.sessionId ? { sessionId: previous.sessionId } : {}),
      slug: msg.slug ?? null,
      /*
       * A first guess from what the user pasted, replaced by the real thing the
       * moment status.md exists.
       *
       * A card that says "Reading the job" for forty seconds is a card you
       * cannot tell apart from the other one you just started. The guess costs
       * nothing and is right often enough, and it is never written anywhere: it
       * is a label on a placeholder, not a fact about the application.
       */
      company: msg.company ?? null,
      role: null,
      label: msg.label ?? "Working",
      events: previous?.events ?? [],
      running: true,
      startedAt: Date.now(),
    };
    jobs.set(id, job);
    broadcast({ t: "job", job: id, slug: job.slug, company: job.company, label: job.label, running: true });

    /*
     * Keep the conversation with the application it is about.
     *
     * Until now it lived only in memory and died with the server, so there was
     * no record of what was asked or what came back. For an application you
     * have actually sent, that is the part worth keeping: the CV explains what
     * you claimed, and only the conversation explains why.
     *
     * Written into the folder rather than a database, so it travels with the
     * application when it is archived and reads without this app.
     */
    const logTurn = (who: string, text: string) => {
      if (!job.slug || !text.trim()) return;
      const dir = jobDir(person, job.slug);
      if (!dir) return;
      try {
        const path = join(dir, "conversation.md");
        const head = existsSync(path)
          ? ""
          : `# Conversation\n\nEverything asked of Boulot about this application, and what it said back.\n`;
        appendFileSync(path, `${head}\n## ${who} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\n${text.trim()}\n`);
      } catch {
        /* the run matters more than its transcript */
      }
    };
    if (msg.note) logTurn("You", msg.note);

    void (async () => {
    try {
      job.sessionId = await run({
        prompt,
        vaultRoot: VAULT,
        person,
        rendererPath: RENDERER,
        // Continues this application's conversation, and only this one's.
        ...(job.sessionId ? { sessionId: job.sessionId } : {}),
        ...(msg.model ? { model: msg.model } : {}),
        onEvent: (e) => {
          /*
           * A new application does not know its own folder when it starts, so
           * the job learns it from the first file written into one. That is what
           * lets the workbench pick up a run that began on the intake screen.
           */
          if (!job.slug && e.t === "file" && typeof e.path === "string") {
            const m = /(?:^|\/)(?:active|archive)\/([^/]+)\//.exec(e.path);
            if (m) {
              job.slug = m[1] ?? null;
              /*
               * Read the truth rather than keep the guess. status.md is written
               * early in the run and carries the company and the role, so from
               * here on the card can say what it actually is.
               */
              try {
                const status = join(VAULT, msg.person!, "active", job.slug!, "status.md");
                if (existsSync(status)) {
                  const a = readApplication(status, job.slug!);
                  job.company = a.company || job.company;
                  job.role = a.role || null;
                }
              } catch {
                /* the guess stands */
              }
              broadcast({ t: "job", job: id, slug: job.slug, company: job.company, role: job.role, label: job.label, running: true });
            }
          }
          if (e.t === "text" && typeof e.text === "string") logTurn("Boulot", e.text);
          const tagged = { ...e, job: id, slug: job.slug };
          // Bounded, because a long research run can emit hundreds of steps and
          // this is only here so a returning screen can catch up.
          job.events.push(tagged);
          if (job.events.length > 400) job.events.splice(0, job.events.length - 400);
          broadcast(tagged);
        },
      });
    } finally {
      job.running = false;
      broadcast({ t: "job", job: id, slug: job.slug, company: job.company, label: job.label, running: false });
    }
    })();
    return null;
  }
}

console.log(`Boulot on ${address}`);
console.log(`  vault:  ${VAULT}${existsSync(VAULT) ? "" : "  (not found)"}`);
console.log(`  people: ${people(VAULT).join(", ") || "none"}`);
console.log(
  `  agent:  ${AUTH_MODE === "api-key" ? "API key (billed per token, capped per run)" : "Claude subscription (counts against your plan's limits)"}`,
);
