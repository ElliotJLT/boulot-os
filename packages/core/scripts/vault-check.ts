import { readVault } from "../src/vault/read.js";
import { nextActions } from "../src/pipeline/flags.js";

const ROOT = process.argv[2] ?? "";
if (!ROOT) { console.error("usage: vault-check <vault-root>"); process.exit(1); }

for (const who of ["ELLIOT", "CHARLOTTE"]) {
  const { applications, skipped } = readVault(`${ROOT}/${who}`);
  const warned = applications.filter((a) => a.warnings.length);
  console.log(`\n=== ${who}: ${applications.length} applications, ${skipped.length} folders without status.md`);
  const byStage: Record<string, number> = {};
  for (const a of applications) byStage[a.stage] = (byStage[a.stage] ?? 0) + 1;
  console.log("  stages:", JSON.stringify(byStage));
  console.log(`  with warnings: ${warned.length}`);
  for (const a of warned.slice(0, 5)) console.log(`      ${a.slug}: ${a.warnings.join("; ")}`);
  const subs = applications.filter((a) => a.substage);
  if (subs.length) {
    console.log("  substages preserved:");
    for (const s of subs.slice(0, 5)) console.log(`      ${s.slug} = "${s.substage}"`);
  }
}

const { applications } = readVault(`${ROOT}/ELLIOT`);
console.log("\n=== ELLIOT next 3 actions (computed, not prompted) ===");
for (const { app, flag } of nextActions(applications)) {
  console.log(`  [${flag.label.padEnd(16)}] ${app.company} — ${app.role.slice(0, 42)}`);
}
