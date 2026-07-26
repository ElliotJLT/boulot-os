import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fetchJob } from "./boards.js";

/**
 * The agent bridge.
 *
 * The board is a receipt, not the product. Nobody maintains a tracker by hand,
 * so the agent owns the vault and the UI just shows what it did. That means
 * this file is the actual application: everything Boulot can do has to be
 * reachable from here.
 */

export interface AgentEvent {
  t: "text" | "tool" | "result" | "error" | "file" | "cost";
  [k: string]: unknown;
}

/**
 * Tool names rendered as something a person would say.
 *
 * A non-technical user should never see `Glob(**\/status.md)`. They should see
 * "Looking through your applications".
 */
function describe(name: string, input: Record<string, unknown>): string {
  /*
   * Say what the file is, not where it lives.
   *
   * "Reading callosum/status.md" while logging a job at a different company
   * reads as the agent having lost track of which application it is on. It has
   * not: checking whether you have applied somewhere before means opening other
   * applications. Naming the company makes that obvious instead of alarming.
   */
  const describeFile = (v: unknown, verb: string): string => {
    if (typeof v !== "string") return verb;
    const parts = v.split("/");
    const name = parts.at(-1) ?? "";
    const folder = parts.at(-2) ?? "";
    const company = folder
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    const KNOWN: Record<string, string> = {
      "cv-master.md": "your career record",
      "profile.md": "your profile",
      "dashboard.md": "your dashboard",
      "MEMORY.md": "what it knows about you",
    };
    if (KNOWN[name]) return `${verb} ${KNOWN[name]}`;

    const inApplication: Record<string, string> = {
      "status.md": `the ${company} application`,
      "job.md": `the ${company} job description`,
      "research.md": `research on ${company}`,
      "cv.md": `the ${company} CV`,
      "cover-letter.md": `the ${company} cover letter`,
      "application-answers.md": `the ${company} questions`,
    };
    return inApplication[name] ? `${verb} ${inApplication[name]}` : `${verb} ${name}`;
  };

  switch (name) {
    case "Read":
      return describeFile(input.file_path, "Reading");
    case "Write":
      return describeFile(input.file_path, "Writing");
    case "Edit":
      return describeFile(input.file_path, "Updating");
    case "Glob":
    case "Grep":
      return "Searching your vault";
    case "WebSearch":
      return `Searching the web for ${String(input.query ?? "").slice(0, 60)}`;
    case "WebFetch":
      return `Reading ${String(input.url ?? "").replace(/^https?:\/\//, "").split("/")[0]}`;
    case "Task": {
      const who = String(input.subagent_type ?? "");
      const named: Record<string, string> = {
        "hiring-manager": "Hiring Manager is scoring your bullets",
        reviewer: "Reviewer is finding the three biggest edits",
        strategist: "Strategist is looking for what you left out",
      };
      return named[who] ?? String(input.description ?? "Working");
    }
    case "Skill":
      return `Running ${String(input.command ?? input.name ?? "a skill")}`;
    case "AskUserQuestion":
      return "Asking you something";
    default:
      if (name.startsWith("mcp__boulot__")) {
        return {
          boulot_render_pdf: "Rendering the PDF",
          boulot_today: "Checking today's date",
          boulot_fetch_job: "Reading the job posting",
        }[
          name.replace("mcp__boulot__", "")
        ] ?? "Working";
      }
      return "Working";
  }
}

/** Tools removed from the model's surface entirely. */
const DENIED = [
  "Bash",
  "Monitor", // executes shell commands: the second door
  // Task is deliberately NOT denied. It is how the three adversarial CV
  // reviewers spawn, which is the most distinctive thing this product does.
  // Denying it for tidiness would delete the feature. Subagents inherit this
  // same deny list, so the shell doors stay shut inside them too (verified).
  "Workflow",
  "ToolSearch",
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
];

/** Boulot's own tools, replacing what Bash used to do. */
function boulotTools(vaultRoot: string, rendererPath: string) {
  return createSdkMcpServer({
    name: "boulot",
    version: "0.1.0",
    tools: [
      tool(
        "boulot_fetch_job",
        "Read a job posting from its URL. Understands Ashby, Greenhouse, Lever and Workable, " +
          "which publish descriptions as structured JSON, and returns the full text plus title, " +
          "location and compensation. ALWAYS try this before WebFetch on a job link: those boards " +
          "render the description in JavaScript, so fetching the page returns only a title. " +
          "If it fails, ask the user to paste the description. Never guess at a job's contents.",
        { url: z.string().describe("The job posting URL") },
        async ({ url }) => {
          const job = await fetchJob(url);
          if (!job.ok) {
            return { content: [{ type: "text", text: job.error ?? "Could not read that posting." }], isError: true };
          }
          const head = [
            `Title: ${job.title}`,
            `Company: ${job.company}`,
            job.location ? `Location: ${job.location}` : "",
            job.employmentType ? `Type: ${job.employmentType}` : "",
            job.compensation ? `Compensation: ${job.compensation}` : "",
            `Source: ${job.source}`,
            `URL: ${job.url}`,
          ].filter(Boolean).join("\n");
          return { content: [{ type: "text", text: `${head}\n\n---\n\n${job.description}` }] };
        },
      ),

      tool("boulot_today", "Get today's date in YYYY-MM-DD form.", {}, async () => ({
        content: [{ type: "text", text: new Date().toISOString().slice(0, 10) }],
      })),

      tool(
        "boulot_render_pdf",
        "Render a tailored cv.md to PDF and check that it fits the page budget. " +
          "Returns a fit report: if the CV is too long it says how many characters to cut and from which section. " +
          "Always call this after writing a cv.md.",
        {
          cvPath: z.string().describe("Absolute path to the cv.md to render"),
          outputPath: z.string().describe("Absolute path for the .pdf to write"),
          maxPages: z.number().optional().describe("Page budget, default 2"),
        },
        async ({ cvPath, outputPath, maxPages }) => {
          // Resolve ONCE, then use the resolved paths everywhere. An earlier
          // version validated the resolved path but passed the raw one on to
          // existsSync and the renderer, so a relative path passed the jail and
          // was then looked up against the process cwd, where it did not exist.
          // The model saw "refused" repeatedly for a path that was in fact
          // fine, and went hunting through config files for a vault root that
          // was never the problem.
          const resolveInVault = (p: string) => (isAbsolute(p) ? p : resolve(vaultRoot, p));
          const cv = resolveInVault(cvPath);
          const pdfOut = resolveInVault(outputPath);

          for (const [label, abs] of [["cvPath", cv], ["outputPath", pdfOut]] as const) {
            const rel = relative(vaultRoot, abs);
            if (rel.startsWith("..") || isAbsolute(rel)) {
              return {
                content: [
                  {
                    type: "text",
                    text:
                      `Refused: ${label} resolved to ${abs}, which is outside the vault.\n` +
                      `The vault root is ${vaultRoot}. Use a path inside it, ` +
                      `either absolute or relative to that root.`,
                  },
                ],
                isError: true,
              };
            }
          }

          if (!existsSync(cv)) {
            return {
              content: [{ type: "text", text: `No such file: ${cv} (vault root is ${vaultRoot})` }],
              isError: true,
            };
          }

          const args = [rendererPath, cv, pdfOut];
          if (maxPages) args.push("--max-pages", String(maxPages));
          const r = spawnSync("node", args, { encoding: "utf8", timeout: 120_000 });
          const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

          // Exit 3 means it rendered but overflows: that is a report to act on,
          // not a failure. Exit 2 means the header is broken and no PDF exists.
          return {
            content: [{ type: "text", text: out.slice(-4000) || "(no output)" }],
            isError: r.status === 2,
          };
        },
      ),
    ],
  });
}

/** A single run should never cost more than a cheap lunch. */
export const DEFAULT_BUDGET_USD = 1.5;


/**
 * The three adversarial reviewers, as first-class agents.
 *
 * Defined here rather than inline in the skill for three reasons. They become
 * nameable, so the UI can say which one is working. They get a cheaper model,
 * because scoring someone else's draft is not the same job as writing it. And
 * they get a read-only tool surface and a turn limit, so a reviewer cannot
 * wander off and rewrite the CV it was asked to critique.
 *
 * The doctrine they exist to serve: if all three agree, the exercise failed.
 */
const REVIEWERS: Record<string, {
  description: string;
  prompt: string;
  model: string;
  tools: string[];
  maxTurns: number;
}> = {
  "hiring-manager": {
    description:
      "Reads a CV draft as the person who wrote the job description. Use during CV tailoring to get relevance scoring and the ordering a hiring manager would want.",
    model: "sonnet",
    tools: ["Read"],
    maxTurns: 4,
    prompt:
      "You are the hiring manager who wrote this job description. You are not the candidate's friend.\n\n" +
      "Read the JD and the CV draft. Answer: what are you actually worried about in this hire? " +
      "What would make you stop reading? What single thing would make you say 'interview this one'?\n\n" +
      "Score every bullet 1 to 5 on relevance to THIS posting, and return the ordering you would want. " +
      "Be blunt about anything that reads as padding. Return the scores and the ordering, nothing else.",
  },
  reviewer: {
    description:
      "Reads a CV draft against the job description and returns the three highest-impact edits. Use during CV tailoring.",
    model: "sonnet",
    tools: ["Read"],
    maxTurns: 4,
    prompt:
      "You are a sharp second reader. Read the CV draft against the JD.\n\n" +
      "Where is a claim unsupported? Where is it generic when it could be specific? Where would a " +
      "recruiter skim past?\n\n" +
      "Return exactly THREE edits: the three that would improve the draft most. Not a teardown, not a " +
      "list of everything wrong. The three that matter. Quote the line and give the replacement.",
  },
  strategist: {
    description:
      "Reads the job description against the full master CV to find underplayed experience. Use during CV tailoring.",
    model: "sonnet",
    tools: ["Read"],
    maxTurns: 4,
    prompt:
      "You look for what is being left out.\n\n" +
      "Read the JD against the candidate's FULL master CV, not just the draft. What experience is being " +
      "underplayed? What is the non-obvious connection between this background and this role?\n\n" +
      "Return exactly THREE bullets that exist in the master CV, are missing from the draft, and should " +
      "not be. Quote each one and say why it belongs. Never invent experience.",
  },
};

/**
 * The consolidated memory, injected once per run.
 *
 * This is the whole point of consolidating. The agent used to start every
 * tailoring run knowing nothing about the person beyond whatever files it chose
 * to open, so it reread the master CV, missed the projects that were never
 * filed there, and rewrote claims the user had already phrased better in six
 * previous applications.
 *
 * Injected as system context rather than pasted into the prompt so it caches
 * across turns, and read fresh each run so an application archived a minute ago
 * is already reflected.
 */
function memoryContext(vaultRoot: string, person: string): string {
  const file = resolve(vaultRoot, person, "profile", "MEMORY.md");
  if (!existsSync(file)) return "";
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  if (!text.trim()) return "";
  return [
    "",
    "# What Boulot knows about this person",
    "",
    "Built from the CVs they have actually sent, not from anything invented.",
    "Prefer these phrasings and these figures over rewriting from scratch, and",
    "never contradict the `Worth checking` section: those are open questions, so",
    "ask rather than assuming an answer.",
    "",
    text.trim(),
  ].join("\n");
}

export interface RunOptions {
  prompt: string;
  vaultRoot: string;
  person: string;
  rendererPath: string;
  sessionId?: string | undefined;
  budgetUsd?: number;
  onEvent: (e: AgentEvent) => void;
}

export async function run({
  prompt,
  vaultRoot,
  person,
  rendererPath,
  sessionId,
  budgetUsd = DEFAULT_BUDGET_USD,
  onEvent,
}: RunOptions): Promise<string | undefined> {
  const cwd = resolve(vaultRoot, person);
  let newSessionId: string | undefined;
  const memory = memoryContext(vaultRoot, person);

  const response = query({
    prompt,
    options: {
      cwd,
      settingSources: [],
      ...(memory ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: memory } } : {}),
      // Overridable for the same reason as the renderer: inside the desktop
      // bundle the skill pack sits beside the server, not two levels up.
      plugins: [{ type: "local", path: process.env.BOULOT_PLUGIN ?? resolve(import.meta.dirname, "../../plugin") }],
      disallowedTools: DENIED,
      mcpServers: { boulot: boulotTools(vaultRoot, rendererPath) },
      agents: REVIEWERS,
      // Boulot's own tools are pre-approved. They are ours, they are
      // path-jailed internally, and prompting for them would be noise: nobody
      // wants to authorise "check today's date". Note this deliberately
      // shadows canUseTool for these names, which is why the jail lives inside
      // the tool and in the PreToolUse hook rather than in the callback.
      allowedTools: [
        "Task",
        "mcp__boulot__boulot_today",
        "mcp__boulot__boulot_fetch_job",
        "mcp__boulot__boulot_render_pdf",
        "Read",
        "Glob",
        "Grep",
        "Write",
        "Edit",
        "WebSearch",
        "WebFetch",
        "Skill",
      ],
      permissionMode: "acceptEdits",
      ...(sessionId ? { resume: sessionId } : {}),
      maxTurns: 40,
      // Backstop, not a plan. One unbounded research run cost $11.75 across 130
      // web searches, which is not a thing a user should be able to trigger by
      // pasting a link. The skill bounds the work; this bounds the damage when
      // the skill is ignored.
      // Only meaningful when billed per token. On a subscription the reported
      // figures are nominal, so a dollar cap there would fire on an amount the
      // user is not actually being charged.
      ...(process.env.ANTHROPIC_API_KEY ? { maxBudgetUsd: budgetUsd } : {}),
      // Writes outside the vault are denied here rather than in canUseTool,
      // because auto-approved tools never reach that callback.
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input: unknown) => {
                const i = input as { tool_name?: string; tool_input?: Record<string, unknown> };
                const path = i.tool_input?.file_path;
                if (typeof path !== "string") return { continue: true };
                const abs = isAbsolute(path) ? path : resolve(cwd, path);
                const rel = relative(vaultRoot, abs);
                if (!rel.startsWith("..") && !isAbsolute(rel)) return { continue: true };

                /*
                 * Say that it was refused.
                 *
                 * The activity log reports tool calls as they are requested, so
                 * a refused read appeared as "Reading left-zero-gravity.md" and
                 * looked exactly like a successful one. That is how a working
                 * path jail came to look like a breach: the agent had tried to
                 * open four files outside the vault, been stopped every time,
                 * and the log showed only the attempts.
                 */
                onEvent({
                  t: "tool",
                  name: i.tool_name ?? "?",
                  label: `Refused: ${path.split("/").pop()} is outside your vault`,
                });

                // Deny THIS TOOL, and only this tool.
                //
                // `continue: false` aborts the entire agent, which is what was
                // producing runs that stopped mid-task and reported success.
                // A model reaching for a stale absolute path (the old
                // /Users/elliot/Desktop/... that still appears in some docs)
                // would silently kill the whole application setup.
                //
                // permissionDecision "deny" refuses the call, hands the model
                // the reason, and lets it correct course.
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse" as const,
                    permissionDecision: "deny" as const,
                    permissionDecisionReason:
                      `${path} is outside the vault. The vault root is ${vaultRoot} and you are in ` +
                      `${cwd}. Use a path inside it. Ignore any absolute path you have seen in ` +
                      `documentation, it may be stale.`,
                  },
                };
              },
            ],
          },
        ],
      },
    },
  });

  try {
    for await (const message of response) {
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = (message as { session_id?: string }).session_id;
      } else if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            onEvent({ t: "text", text: block.text });
          } else if (block.type === "tool_use") {
            onEvent({
              t: "tool",
              name: block.name,
              label: describe(block.name, block.input as Record<string, unknown>),
            });
            const fp = (block.input as { file_path?: string }).file_path;
            if (fp && (block.name === "Write" || block.name === "Edit")) {
              onEvent({ t: "file", path: fp });
            }
          }
        }
      } else if (message.type === "result") {
        const m = message as {
          total_cost_usd?: number;
          is_error?: boolean;
          session_id?: string;
          subtype?: string;
          stop_reason?: string;
          num_turns?: number;
        };
        // Runs occasionally end with stop_reason "tool_use", meaning the model
        // emitted a tool call the loop never executed, so nothing happens and
        // the user sees a reply that promises work it did not do. Surfaced
        // rather than swallowed.
        if (m.subtype === "error_max_budget_usd") {
          onEvent({
            t: "error",
            message:
              `That run hit its £${(budgetUsd * 0.79).toFixed(2)} budget and stopped. ` +
              `Anything already written has been kept. Ask for a narrower next step.`,
          });
        } else if (m.stop_reason === "tool_use") {
          onEvent({
            t: "error",
            message: "That run stopped before finishing. Nothing was changed. Try asking again.",
          });
        }
        newSessionId = m.session_id ?? newSessionId;
        onEvent({ t: "result", cost: m.total_cost_usd ?? 0, error: m.is_error ?? false });
      }
    }
  } catch (err) {
    onEvent({ t: "error", message: err instanceof Error ? err.message : String(err) });
  }

  return newSessionId;
}
