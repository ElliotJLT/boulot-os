/**
 * Agent SDK spike.
 *
 * De-risks the runtime before any UI is written. Answers, empirically:
 *   1. does a local plugin load, and how are its skills namespaced?
 *   2. does settingSources: [] really isolate us from ~/.claude and the vault?
 *   3. what does canUseTool actually receive?
 *   4. is Bash genuinely absent from the model's toolset when denied by name?
 *   5. what cost data comes back?
 *
 * Run: pnpm --filter @boulot/server spike
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(here, "../../plugin");
const workspace = resolve(here, "../../../.spike-workspace");

const seen = {
  init: null as unknown,
  permissionRequests: [] as Array<{ tool: string; input: unknown }>,
  toolsUsed: new Set<string>(),
  text: [] as string[],
  cost: null as number | null,
};

const response = query({
  prompt:
    "Do exactly two things, briefly. " +
    "1) List the names of the skills you can see. " +
    "2) Try to run the shell command `echo hello` and tell me plainly whether a bash tool was available to you.",
  options: {
    cwd: workspace,
    // Isolation: no ~/.claude, no project .claude, no CLAUDE.md.
    settingSources: [],
    plugins: [{ type: "local", path: pluginDir }],
    // NOTE (found by running this): `allowedTools` does not restrict anything.
    // Bare entries AUTO-APPROVE, shadowing canUseTool entirely (the SDK emits
    // CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). Only `disallowedTools` removes a tool
    // from the model's surface. So the deny list is the whole security model,
    // and it has to be exhaustive.
    //
    // Also found by running this: denying Bash does NOT close shell access.
    // The model itself pointed out that `Monitor` executes shell commands in
    // the same environment. A deny list that stops at "Bash" is theatre.
    disallowedTools: [
      "Bash",
      "Monitor", // executes shell commands - the real second door
      "Task", // can spawn a subagent with its own tool surface
      "Workflow",
      "ToolSearch", // can surface deferred tools we thought we had excluded
      "NotebookEdit",
      "CronCreate",
      "CronDelete",
      "CronList",
      "ScheduleWakeup",
      "PushNotification",
      "SendMessage",
      "EnterWorktree",
      "ExitWorktree",
      "EnterPlanMode",
      "ExitPlanMode",
      "DesignSync",
      "ReportFindings",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskOutput",
      "TaskStop",
      "TaskUpdate",
    ],
    permissionMode: "default",
    maxTurns: 6,
    canUseTool: async (toolName, input, _options) => {
      seen.permissionRequests.push({ tool: toolName, input });
      return { behavior: "allow", updatedInput: input };
    },
  },
});

for await (const message of response) {
  if (message.type === "system" && message.subtype === "init") {
    seen.init = message;
  } else if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text") seen.text.push(block.text);
      if (block.type === "tool_use") seen.toolsUsed.add(block.name);
    }
  } else if (message.type === "result") {
    seen.cost = (message as { total_cost_usd?: number }).total_cost_usd ?? null;
  }
}

const init = seen.init as Record<string, unknown> | null;
const line = (k: string, v: unknown) => console.log(`  ${k.padEnd(22)} ${JSON.stringify(v)}`);

console.log("\n=== system/init ===");
if (init) {
  for (const key of ["model", "permissionMode", "cwd", "slash_commands", "plugins", "skills"]) {
    if (key in init) line(key, init[key]);
  }
  line("tools (count)", Array.isArray(init.tools) ? (init.tools as unknown[]).length : "?");
  const tools = (init.tools as string[] | undefined) ?? [];
  line("Bash present?", tools.includes("Bash"));
  line("tools", tools);
} else {
  console.log("  no init message received");
}

console.log("\n=== canUseTool fired for ===");
console.log(seen.permissionRequests.length ? seen.permissionRequests.map((p) => `  ${p.tool}`).join("\n") : "  (nothing)");

console.log("\n=== tools the model actually used ===");
console.log(`  ${[...seen.toolsUsed].join(", ") || "(none)"}`);

console.log("\n=== what it said ===");
console.log(seen.text.join("\n").split("\n").map((l) => `  ${l}`).join("\n"));

console.log(`\n=== cost ===\n  $${seen.cost?.toFixed(4) ?? "?"}\n`);
