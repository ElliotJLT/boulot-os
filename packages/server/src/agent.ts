import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
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
  const file = (v: unknown) => (typeof v === "string" ? v.split("/").slice(-2).join("/") : "");
  switch (name) {
    case "Read":
      return `Reading ${file(input.file_path)}`;
    case "Write":
      return `Writing ${file(input.file_path)}`;
    case "Edit":
      return `Editing ${file(input.file_path)}`;
    case "Glob":
    case "Grep":
      return "Searching your vault";
    case "WebSearch":
      return `Searching the web for ${String(input.query ?? "").slice(0, 60)}`;
    case "WebFetch":
      return `Reading ${String(input.url ?? "").replace(/^https?:\/\//, "").split("/")[0]}`;
    case "Task":
      return `${String(input.description ?? "Working")}`;
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

  const response = query({
    prompt,
    options: {
      cwd,
      settingSources: [],
      plugins: [{ type: "local", path: resolve(import.meta.dirname, "../../plugin") }],
      disallowedTools: DENIED,
      mcpServers: { boulot: boulotTools(vaultRoot, rendererPath) },
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
      maxBudgetUsd: budgetUsd,
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
