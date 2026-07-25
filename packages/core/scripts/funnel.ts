import { readVault } from "../src/vault/read.js";
import { buildFunnel } from "../src/learning/funnel.js";

const ROOT = process.argv[2] ?? "";
for (const who of ["ELLIOT", "CHARLOTTE"]) {
  const { applications } = readVault(`${ROOT}/${who}`);
  const f = buildFunnel(applications);
  console.log(`\n=== ${who} — derived from status.md, zero manual bookkeeping ===`);
  const width = 34;
  for (const s of f.stages) {
    const bar = "█".repeat(Math.round(s.rate * width));
    console.log(`  ${s.label.padEnd(10)} ${String(s.count).padStart(3)}  ${bar} ${(s.rate * 100).toFixed(0)}%`);
  }
  console.log(`  median days applied → closed: ${f.medianDaysToClose ?? "n/a"}`);
  console.log(`  presumed ghosted (silent >45d, never closed): ${f.presumedGhosted}`);
  const named = f.bySource.filter((s) => s.source !== "unknown" && s.applied > 1);
  if (named.length) {
    console.log("  by source:");
    for (const s of named.slice(0, 6)) {
      console.log(`      ${s.source.padEnd(14)} ${s.interviewed}/${s.applied} → interview  (${(s.rate * 100).toFixed(0)}%)`);
    }
  }
}
