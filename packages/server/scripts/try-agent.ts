import { run } from "../src/agent.js";
import { resolve } from "node:path";

const vault = process.env.BOULOT_VAULT!;
const renderer = resolve(vault, ".claude/skills/cv-generator/scripts/generate-pdf.mjs");

await run({
  prompt: process.argv[2] ?? "What is today's date? Use your tool. Then say how many folders are in active/.",
  vaultRoot: vault,
  person: "ELLIOT",
  rendererPath: renderer,
  onEvent: (e) => {
    if (e.t === "tool") console.log(`  · ${e.label}`);
    else if (e.t === "text") console.log(`\n${e.text}\n`);
    else if (e.t === "file") console.log(`  [file] ${e.path}`);
    else if (e.t === "result") console.log(`  — done, $${(e.cost as number).toFixed(4)}`);
    else if (e.t === "error") console.log(`  !! ${e.message}`);
  },
});
