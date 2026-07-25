import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { readVault, buildFunnel, flagsFor, nextActions, readMaster } from "@boulot/core";
import { run } from "./agent.js";

/**
 * The Boulot local server.
 *
 * Everything except the agent bridge works without an API key, on purpose: the
 * board, the CV editor and the PDF preview are most of the app, and none of
 * them should cost anything to open.
 */

const VAULT = process.env.BOULOT_VAULT ?? resolve(process.env.HOME ?? ".", "Boulot");
const PORT = Number(process.env.PORT ?? 4319);
const RENDERER = resolve(VAULT, ".claude/skills/cv-generator/scripts/generate-pdf.mjs");

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
const PERSON = process.env.BOULOT_PERSON ?? null;

function people(vault: string): string[] {
  if (!existsSync(vault)) return [];
  if (PERSON) return existsSync(join(vault, PERSON)) ? [PERSON] : [];
  return readdirSync(vault)
    .filter((n) => !n.startsWith("."))
    .filter((n) => {
      const p = join(vault, n);
      return statSync(p).isDirectory() && existsSync(join(p, "active"));
    });
}

/** Resolve a vault path from untrusted segments, or throw. */
function inVault(...segments: string[]): string {
  const abs = resolve(VAULT, ...segments);
  const rel = relative(VAULT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes the vault");
  return abs;
}

app.get("/api/health", async () => ({
  ok: true,
  vault: VAULT,
  vaultExists: existsSync(VAULT),
  people: people(VAULT),
  authMode: AUTH_MODE,
  rendererFound: existsSync(RENDERER),
}));

/** The master CV, read as a record: entries, tags, and what actually gets used. */
app.get<{ Params: { who: string } }>("/api/:who/master", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
  // Cross bullet usage with what actually happened to those applications.
  const { applications } = readVault(dir);
  const reachedInterview = new Set<string>();
  const rejected = new Set<string>();
  for (const a of applications) {
    const got = ["screening", "interviewing", "offer", "closed-won"].includes(a.stage) ||
      /interview|screen|final|task day/i.test(a.substage ?? "");
    if (got) reachedInterview.add(a.slug);
    else if (a.stage === "closed-lost") rejected.add(a.slug);
  }
  const m = readMaster(dir, { reachedInterview, rejected });
  return m ?? reply.code(404).send({ error: "no cv-master.md" });
});

app.get<{ Params: { who: string } }>("/api/:who/board", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: "no such person" });
  const { applications, skipped } = readVault(dir);
  const today = new Date();
  return {
    person: req.params.who,
    applications: applications.map((a) => ({ ...a, flags2: flagsFor(a, today) })),
    nextActions: nextActions(applications, today).map(({ app: a, flag }) => ({
      slug: a.slug,
      company: a.company,
      role: a.role,
      flag,
    })),
    funnel: buildFunnel(applications, today),
    skipped,
  };
});

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
  job: { file: "job.md", label: "Job description" },
  research: { file: "research.md", label: "Research" },
} as const;
type DocKey = keyof typeof DOCS;

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
    pdf: existsSync(join(dir, "cv.pdf")),
    fit: existsSync(fitPath) ? JSON.parse(readFileSync(fitPath, "utf8")) : null,
  };
});

app.get<{ Params: { who: string; slug: string; doc: DocKey } }>(
  "/api/:who/job/:slug/doc/:doc",
  async (req, reply) => {
    const meta = DOCS[req.params.doc];
    if (!meta) return reply.code(400).send({ error: "unknown document" });
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    const p = join(dir, meta.file);
    return { markdown: existsSync(p) ? readFileSync(p, "utf8") : "", exists: existsSync(p) };
  },
);

app.put<{ Params: { who: string; slug: string; doc: DocKey }; Body: { markdown: string } }>(
  "/api/:who/job/:slug/doc/:doc",
  async (req, reply) => {
    const meta = DOCS[req.params.doc];
    if (!meta) return reply.code(400).send({ error: "unknown document" });
    if (typeof req.body?.markdown !== "string") return reply.code(400).send({ error: "markdown required" });
    const dir = jobDir(req.params.who, req.params.slug);
    if (!dir) return reply.code(404).send({ error: "no such application" });
    writeFileSync(join(dir, meta.file), req.body.markdown);
    return { saved: true };
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
      pdf: existsSync(out) ? "cv.pdf" : null,
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

const webDist = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html"),
  );
}

const address = await app.listen({ port: PORT, host: "127.0.0.1" });

/** Agent bridge. One socket per run; the client sends a prompt, we stream back. */
const wss = new WebSocketServer({ server: app.server, path: "/ws" });
wss.on("connection", (socket) => {
  let sessionId: string | undefined;
  socket.on("message", async (raw) => {
    let msg: { prompt?: string; person?: string };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg.prompt || !msg.person) return;

    sessionId = await run({
      prompt: msg.prompt,
      vaultRoot: VAULT,
      person: msg.person,
      rendererPath: RENDERER,
      sessionId,
      onEvent: (e) => {
        // A closed socket must never kill the run. Writing to one throws, and
        // that exception used to propagate into the agent loop and end it
        // early, which surfaced as a reply describing work that never happened.
        try {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e));
        } catch {
          /* client went away; the run continues and the vault is still written */
        }
      },
    });
  });
});

console.log(`Boulot on ${address}`);
console.log(`  vault:  ${VAULT}${existsSync(VAULT) ? "" : "  (not found)"}`);
console.log(`  people: ${people(VAULT).join(", ") || "none"}`);
console.log(
  `  agent:  ${AUTH_MODE === "api-key" ? "API key (billed per token, capped per run)" : "Claude subscription (counts against your plan's limits)"}`,
);
