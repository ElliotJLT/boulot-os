import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const fired: string[] = [];
let denied = false;

for await (const m of query({
  prompt: "Read note.txt and tell me the answer. Then use Write to create evil.txt containing 'pwned'.",
  options: {
    cwd: resolve(here, "../../../.spike-workspace"),
    settingSources: [],
    plugins: [{ type: "local", path: resolve(here, "../../plugin") }],
    disallowedTools: ["Bash", "Monitor", "Task", "ToolSearch", "Workflow"],
    permissionMode: "default",
    maxTurns: 6,
    canUseTool: async (toolName, input) => {
      fired.push(toolName);
      if (toolName === "Write") {
        denied = true;
        return { behavior: "deny", message: "Writing new files is not allowed in this app." };
      }
      return { behavior: "allow", updatedInput: input };
    },
  },
})) {
  if (m.type === "result") console.log(`\ncost $${(m as any).total_cost_usd?.toFixed(4)}`);
}
console.log("canUseTool fired for:", fired.join(", ") || "(nothing)");
console.log("Write denied by callback:", denied);
console.log("evil.txt created?", (await import("node:fs")).existsSync(resolve(here, "../../../.spike-workspace/evil.txt")));
