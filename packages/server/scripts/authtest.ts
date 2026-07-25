import { query } from "@anthropic-ai/claude-agent-sdk";
// Deliberately NO api key in env: does the SDK fall back to the Claude Code login?
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
try {
  for await (const m of query({
    prompt: "Reply with exactly: OK",
    options: { settingSources: [], disallowedTools: ["Bash","Task","Read","Glob","Grep","WebSearch","WebFetch","ToolSearch","Skill","Monitor"], maxTurns: 1 },
  })) {
    if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") console.log("said:", b.text.trim());
    if (m.type === "result") {
      const r = m as any;
      console.log("subtype:", r.subtype);
      console.log("subscription_type:", r.subscription_type);
      console.log("cost_usd:", r.total_cost_usd);
    }
  }
} catch (e) { console.log("FAILED:", e instanceof Error ? e.message.slice(0,200) : String(e)); }
