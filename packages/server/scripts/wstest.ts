import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:4319/ws");
ws.on("open", () => ws.send(JSON.stringify({
  person: "ELLIOT",
  prompt: "In active/gradient-labs/cv.md, change the Summary line 'Maintain open-source eval frameworks and MCP servers' to say 'Maintain open-source safeguarding evals and MCP servers'. Change nothing else. Confirm in one short sentence.",
})));
ws.on("message", (d) => {
  const e = JSON.parse(String(d));
  if (e.t === "tool") console.log(`  · ${e.label}`);
  else if (e.t === "file") console.log(`  [wrote] ${String(e.path).split("/").slice(-2).join("/")}`);
  else if (e.t === "text") console.log(`\n${e.text}\n`);
  else if (e.t === "result") { console.log(`  — $${(e.cost as number).toFixed(4)}`); ws.close(); }
  else if (e.t === "error") console.log(`  !! ${e.message}`);
});
