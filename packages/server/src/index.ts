import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readVault, buildFunnel, flagsFor, nextActions } from "@boulot/core";

/**
 * The Boulot local server.
 *
 * Runs on the user's machine, serves the UI, and reads their vault. Nothing
 * here talks to Anthropic: the agent bridge is separate, so every screen that
 * does not need a model keeps working without an API key. That is deliberate.
 * The board, the funnel and the PDF preview are the majority of the app and
 * none of them should cost a penny or require credentials to look at.
 */

const VAULT = process.env.BOULOT_VAULT ?? resolve(process.env.HOME ?? ".", "Boulot");
const PORT = Number(process.env.PORT ?? 4319);

const app = Fastify({ logger: false });

/** People are top-level folders holding an `active/` directory. */
function people(vault: string): string[] {
  if (!existsSync(vault)) return [];
  return readdirSync(vault)
    .filter((n) => !n.startsWith("."))
    .filter((n) => {
      const p = join(vault, n);
      return statSync(p).isDirectory() && existsSync(join(p, "active"));
    });
}

app.get("/api/health", async () => ({
  ok: true,
  vault: VAULT,
  vaultExists: existsSync(VAULT),
  people: people(VAULT),
}));

app.get<{ Params: { who: string } }>("/api/:who/board", async (req, reply) => {
  const dir = join(VAULT, req.params.who);
  if (!existsSync(dir)) return reply.code(404).send({ error: `no such person: ${req.params.who}` });

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
    warnings: applications.filter((a) => a.warnings.length).length,
  };
});

// Serve the built UI when it exists; in dev, Vite serves it instead.
const webDist = resolve(import.meta.dirname, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
}

const address = await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`Boulot server on ${address}`);
console.log(`  vault: ${VAULT}${existsSync(VAULT) ? "" : "  (not found)"}`);
console.log(`  people: ${people(VAULT).join(", ") || "none"}`);
