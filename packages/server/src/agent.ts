import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { existsSync } from "node:fs";

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
        return { boulot_render_pdf: "Rendering the PDF", boulot_today: "Checking today's date" }[
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
  "Task",
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

export interface RunOptions {
  prompt: string;
  vaultRoot: string;
  person: string;
  rendererPath: string;
  sessionId?: string | undefined;
  onEvent: (e: AgentEvent) => void;
}

export async function run({
  prompt,
  vaultRoot,
  person,
  rendererPath,
  sessionId,
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
        "mcp__boulot__boulot_today",
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
                if (rel.startsWith("..") || isAbsolute(rel)) {
                  return {
                    continue: false,
                    stopReason: `Boulot only writes inside your vault. Refused: ${path}`,
                  };
                }
                return { continue: true };
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
        const m = message as { total_cost_usd?: number; is_error?: boolean; session_id?: string };
        newSessionId = m.session_id ?? newSessionId;
        onEvent({ t: "result", cost: m.total_cost_usd ?? 0, error: m.is_error ?? false });
      }
    }
  } catch (err) {
    onEvent({ t: "error", message: err instanceof Error ? err.message : String(err) });
  }

  return newSessionId;
}
