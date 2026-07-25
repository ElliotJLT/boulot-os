import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { readVault, buildFunnel, flagsFor, nextActions } from "@boulot/core";
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

function people(vault: string): string[] {
  if (!existsSync(vault)) return [];
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

/** The CV for one application, plus whether a rendered PDF exists. */
app.get<{ Params: { who: string; slug: string } }>("/api/:who/job/:slug/cv", async (req, reply) => {
  const { who, slug } = req.params;
  for (const bucket of ["active", "archive"]) {
    try {
      const dir = inVault(who, bucket, slug);
      const cv = join(dir, "cv.md");
      if (!existsSync(cv)) continue;
      const pdfs = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
      const fitPath = join(dir, "cv.fit.json");
      return {
        markdown: readFileSync(cv, "utf8"),
        bucket,
        pdf: pdfs[0] ?? null,
        fit: existsSync(fitPath) ? JSON.parse(readFileSync(fitPath, "utf8")) : null,
      };
    } catch {
      /* fall through */
    }
  }
  return reply.code(404).send({ error: "no cv.md for that application" });
});

app.put<{ Params: { who: string; slug: string }; Body: { markdown: string } }>(
  "/api/:who/job/:slug/cv",
  async (req, reply) => {
    const { who, slug } = req.params;
    if (typeof req.body?.markdown !== "string") return reply.code(400).send({ error: "markdown required" });
    for (const bucket of ["active", "archive"]) {
      const cv = join(VAULT, who, bucket, slug, "cv.md");
      if (!existsSync(cv)) continue;
      writeFileSync(inVault(who, bucket, slug, "cv.md"), req.body.markdown);
      return { saved: true };
    }
    return reply.code(404).send({ error: "no cv.md for that application" });
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
