import { query } from "@anthropic-ai/claude-agent-sdk";
const vault = process.env.BOULOT_VAULT!;
for await (const m of query({
  prompt: "Without searching any files, answer from your loaded instructions only: what is the 'swap test' and when do you apply it? If you have no instruction about it, say exactly NO_RULE_LOADED.",
  options: {
    cwd: `${vault}/ELLIOT`,
    settingSources: ["project"],   // load .claude/ from the vault, as Claude Code would
    disallowedTools: ["Bash","Read","Glob","Grep","Task","Monitor","WebSearch","WebFetch","ToolSearch","Skill"],
    maxTurns: 2,
  },
})) {
  if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text") console.log(b.text.slice(0, 500));
}
