import { query } from "@anthropic-ai/claude-agent-sdk";
const vault = process.env.BOULOT_VAULT!;
// Fair test: actually READ a file the rule claims to scope to
// (.claude/rules/application-answers.md declares paths "**/cover-letter*.md"),
// then ask whether the rule attached.
for await (const m of query({
  prompt:
    "Read ELLIOT/archive/reflection/cover-letter.md. " +
    "Then, WITHOUT reading any other file, tell me: do your instructions contain a rule called the 'swap test'? " +
    "Answer RULE_LOADED plus a one-line definition, or NO_RULE_LOADED.",
  options: {
    cwd: `${vault}/ELLIOT`,
    settingSources: ["project"],
    allowedTools: ["Read"],
    disallowedTools: ["Bash","Task","Monitor","Glob","Grep","WebSearch","WebFetch","ToolSearch","Skill"],
    maxTurns: 4,
  },
})) {
  if (m.type === "assistant") for (const b of m.message.content) if (b.type === "text" && b.text.trim()) console.log(b.text.slice(0, 400));
}
