import { readMaster } from "../src/vault/master.js";
const m = readMaster(process.argv[2] ?? "");
if (!m) { console.log("no cv-master.md"); process.exit(1); }
console.log(`updated ${m.updated}`);
console.log(`${m.totals.bullets} entries · ${m.totals.tagged} tagged · ${m.totals.withNumbers} carry a number · ${m.totals.used} used in a real application\n`);
for (const r of m.roles) {
  const used = r.bullets.filter(b => b.usedIn.length).length;
  console.log(`  ${r.org}  (${r.dates})  ${r.bullets.length} entries, ${used} ever used, ${r.deeperDetail} interview-only`);
}
console.log("\ntop tags:", m.allTags.slice(0,8).map(t=>`${t.tag}(${t.count})`).join(" "));
console.log("summary variants:", m.summaryVariants.join(" | "));
const never = m.roles.flatMap(r=>r.bullets).filter(b=>!b.usedIn.length);
console.log(`\nnever used in any application: ${never.length}`);
for (const b of never.slice(0,5)) console.log("   ·", b.text.slice(0,72));
