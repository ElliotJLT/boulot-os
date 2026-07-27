import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { whatWorked, readVault, readDetails } from "@boulot/core";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { resolve, relative, isAbsolute, dirname, basename } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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
      /*
       * Name the reviewer, whatever it was spawned as.
       *
       * The log showed "Working" three times in a row for the most distinctive
       * thing this app does. subagent_type is the reliable field when it is
       * there, but the model does not always set it, so the description and the
       * prompt are searched for who this actually is. A run that says "Hiring
       * Manager is scoring your bullets" reads as three specialists at work; a
       * run that says "Working" three times reads as a stuck spinner.
       */
      const named: Record<string, string> = {
        "hiring-manager": "Hiring Manager is scoring your bullets",
        reviewer: "Reviewer is finding the three biggest edits",
        strategist: "Strategist is looking for what you left out",
      };
      const who = String(input.subagent_type ?? "");
      if (named[who]) return named[who]!;

      const haystack = `${input.description ?? ""} ${input.prompt ?? ""}`.toLowerCase();
      if (/hiring manager/.test(haystack)) return named["hiring-manager"]!;
      if (/left out|underplay|strategist/.test(haystack)) return named.strategist!;
      if (/second reader|three edits|reviewer/.test(haystack)) return named.reviewer!;
      return String(input.description ?? "Working");
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
/**
 * @param cwd Where the agent stands, which is the person's folder rather than
 *            the vault root. Relative paths it hands us are relative to this.
 */
/**
 * Whether a path is inside the vault, comparing real paths.
 *
 * Two checks needed this and only one of them had it, which is the usual result
 * of writing the same logic twice. On macOS /tmp is a symlink to /private/tmp,
 * so a vault at /tmp/x holds files that resolve to /private/tmp/x and a naive
 * comparison calls them outsiders. Nobody with a vault under their home
 * directory would ever see it, which is why it survived.
 */
export function insideVault(vaultRoot: string, target: string): boolean {
  const realOf = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      // A file being written does not exist yet, so its parent is the test.
      try {
        return resolve(realpathSync(dirname(p)), p.split("/").pop() ?? "");
      } catch {
        return p;
      }
    }
  };
  const rel = relative(realOf(vaultRoot), realOf(target));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function boulotTools(vaultRoot: string, rendererPath: string, cwd: string) {
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
          cvPath: z.string().describe("Path to the cv.md to render"),
          maxPages: z.number().optional().describe("Page budget, default 2"),
        },
        async ({ cvPath, maxPages }) => {
          // Resolve ONCE, then use the resolved paths everywhere. An earlier
          // version validated the resolved path but passed the raw one on to
          // existsSync and the renderer, so a relative path passed the jail and
          // was then looked up against the process cwd, where it did not exist.
          // The model saw "refused" repeatedly for a path that was in fact
          // fine, and went hunting through config files for a vault root that
          // was never the problem.
          /*
           * Relative to where the agent actually stands.
           *
           * This resolved against vaultRoot, but the agent's working directory
           * is vaultRoot/PERSON, so the perfectly correct "active/lawhive/cv.md"
           * became ".../Boulot/active/lawhive/cv.md" and did not exist. The
           * model then searched the vault six times and eventually reported
           * "Found it, cwd is .../ELLIOT", which was the answer all along.
           *
           * Both bases are tried, because a model that has read the vault root
           * from somewhere may legitimately pass either.
           */
          const resolveInVault = (p: string) => {
            if (isAbsolute(p)) return p;
            const fromCwd = resolve(cwd, p);
            if (existsSync(fromCwd)) return fromCwd;
            const fromRoot = resolve(vaultRoot, p);
            return existsSync(fromRoot) ? fromRoot : fromCwd;
          };
          const cv = resolveInVault(cvPath);
          /*
           * The PDF is always cv.pdf, beside its cv.md. Not negotiable.
           *
           * This was an outputPath the model chose, and on the Clera
           * application it chose "Elliot Little - Clera - Founding Product
           * Engineer.pdf", which is the download filename pattern. That is a
           * real file and a correct render, and it is invisible: the workbench
           * looks for cv.pdf, so the PDF tab never appeared, the checklist said
           * the PDF step was still outstanding, and the agent reported "rendered
           * at 2 pages" over a screen showing it had not been.
           *
           * How a file is named when you download it is a presentation concern
           * and is already handled at download time. Taking the parameter away
           * makes the whole failure impossible rather than instructing against
           * it, which is the only kind of fix that holds with a model in the
           * loop.
           */
          const pdfOut = resolve(dirname(cv), "cv.pdf");

          for (const [label, abs] of [["cvPath", cv], ["outputPath", pdfOut]] as const) {
            if (!insideVault(vaultRoot, abs)) {
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
  const read = (...parts: string[]) => {
    const file = resolve(vaultRoot, person, ...parts);
    if (!existsSync(file)) return "";
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      return "";
    }
  };

  const text = read("profile", "MEMORY.md");
  /*
   * Corrections, kept.
   *
   * Facts about a career are only half of what the system needs to stop being
   * told what to do. The other half is judgement: that a bare PR count is a
   * vanity metric, that a summary runs long, that a particular framing reads as
   * padding. Those arrive as corrections in conversation and evaporate the
   * moment the run ends, so the same note gets made again next week.
   *
   * This file is where they survive. It is loaded before every run, above the
   * facts, because a lesson is an instruction and a fact is only evidence.
   */
  const lessons = read("profile", "lessons.md");
  /*
   * What actually happened, which is the only feedback with a scoreboard.
   *
   * Lessons are corrections about how to write. This is the record of what the
   * writing produced: rejected, ghosted, reached an interview, and the sentence
   * the person wrote in the hour afterwards. One of those is an anecdote; five
   * of them is a pattern, and the pattern should be visible to the thing doing
   * the writing rather than only to the person doing the remembering.
   */
  const outcomes = read("profile", "outcomes.md");

  /*
   * Deal-breakers, above everything else in the prompt.
   *
   * The cheapest application is the one not written. These are the constraints
   * the person set when they were thinking clearly, and the moment they matter
   * is before a research pass has been spent, not after an evening has.
   */
  let breakers = "";
  try {
    const d = readDetails(resolve(vaultRoot, person));
    const lines = [
      d.minSalary ? `- Minimum salary: ${d.minSalary}` : "",
      d.locationRules ? `- Location: ${d.locationRules}` : "",
      d.avoid ? `- Will not apply to: ${d.avoid}` : "",
    ].filter(Boolean);
    if (lines.length) breakers = lines.join("\n");
  } catch {
    /* no profile, no constraints */
  }

  /*
   * What has actually worked, computed fresh at the start of every run.
   *
   * The bullet match already feeds usage back through consolidation, but the
   * two most-tailored sentences on any CV — the headline and the summary —
   * were written new every time and forgotten. The agent kept rewriting its
   * most important line with no memory of which versions had ever earned a
   * reply.
   *
   * Live rather than cached, because an application moving to Interviewing
   * this morning should change what gets written this afternoon. Deterministic
   * and from the same code the Profile page uses, so the person and the agent
   * are always looking at the same numbers.
   */
  let worked = "";
  try {
    const { applications } = readVault(resolve(vaultRoot, person));
    const w = whatWorked(resolve(vaultRoot, person), applications);
    if (w.reached > 0) {
      const quote = (r: { text: string; usedIn: string[]; reached: number }) =>
        `- "${r.text.length > 160 ? r.text.slice(0, 157) + "..." : r.text}" — on ${r.usedIn.length} CV${r.usedIn.length === 1 ? "" : "s"}, ${r.reached} reached interview`;
      worked = [
        `Of ${w.withCv} applications with a CV on file, ${w.reached} reached a screen or interview.`,
        "",
        ...(w.headlines.some((h) => h.reached)
          ? ["Headlines that reached interviews:", ...w.headlines.filter((h) => h.reached).slice(0, 3).map(quote), ""]
          : []),
        ...(w.summaries.some((x) => x.reached)
          ? ["Summaries that reached interviews:", ...w.summaries.filter((x) => x.reached).slice(0, 2).map(quote), ""]
          : []),
        "Small sample: treat these as the strongest available starting point, not a",
        "rule. When tailoring a headline or summary, start from a version that has",
        "reached an interview and adapt it to this role, rather than inventing a new",
        "positioning from scratch. Never reuse company-specific wording.",
      ].join("\n");
    }
  } catch {
    /* a vault that cannot be read simply contributes nothing here */
  }

  if (!text && !lessons && !outcomes && !worked && !breakers) return "";
  return [
    "",
    ...(lessons
      ? [
          "# What this person has already told you",
          "",
          "Corrections from previous sessions. They were made once and should not",
          "have to be made again. Treat them as instructions, not suggestions.",
          "",
          lessons,
          "",
        ]
      : []),
    "# The vault is the only thing you can read",
    "",
    "Everything you need is inside this folder. Files outside it cannot be opened,",
    "including anything Claude Code's own memory mentions: those paths belong to a",
    "different tool and are not available here. Do not try them, and do not search",
    "for them inside the vault either. If something is not here, say so and carry on.",
    "",
    ...(breakers
      ? [
          "# Deal-breakers",
          "",
          "Constraints this person set in advance. Check a new role against them BEFORE",
          "researching it or writing anything. If a role breaks one, say so plainly and",
          "ask whether to continue rather than carrying on: the point of these is to save",
          "an evening, and that only works if the check happens first.",
          "",
          breakers,
          "",
        ]
      : []),
    ...(worked
      ? ["# What has actually worked", "", worked, ""]
      : []),
    ...(outcomes
      ? [
          "# What happened to previous applications",
          "",
          "Outcomes and what was learned from them. A single rejection says little;",
          "a pattern across several is worth acting on. Do not repeat a framing that",
          "has been noted here as having failed.",
          "",
          outcomes,
          "",
        ]
      : []),
    "# What Boulot knows about this person",
    "",
    "Built from the CVs they have actually sent, not from anything invented.",
    "Prefer these phrasings and these figures over rewriting from scratch, and",
    "never contradict the `Worth checking` section: those are open questions, so",
    "ask rather than assuming an answer.",
    "",
    text,
  ].join("\n");
}

export interface RunOptions {
  prompt: string;
  vaultRoot: string;
  person: string;
  rendererPath: string;
  sessionId?: string | undefined;
  /**
   * Which model does this piece of work.
   *
   * The reviewers have always been on a cheaper one, because scoring someone
   * else's draft is not the same job as writing it. The main agent had no model
   * set at all, so extracting facts from a job advert ran on the same model as
   * the one judgement call in the whole product.
   *
   * Left undefined for anything that has not been thought about, which keeps
   * the default rather than quietly downgrading work nobody has assessed.
   */
  model?: string | undefined;
  budgetUsd?: number;
  onEvent: (e: AgentEvent) => void;
}

export async function run({
  prompt,
  vaultRoot,
  person,
  rendererPath,
  sessionId,
  model,
  budgetUsd = DEFAULT_BUDGET_USD,
  onEvent,
}: RunOptions): Promise<string | undefined> {
  const cwd = resolve(vaultRoot, person);
  let newSessionId: string | undefined;
  const memory = memoryContext(vaultRoot, person);
  /** Refused reads so far, so the message can get firmer rather than repeat. */
  let refusals = 0;

  const response = query({
    prompt,
    options: {
      cwd,
      settingSources: [],
      ...(model ? { model } : {}),
      ...(memory ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: memory } } : {}),
      // Overridable for the same reason as the renderer: inside the desktop
      // bundle the skill pack sits beside the server, not two levels up.
      plugins: [{ type: "local", path: process.env.BOULOT_PLUGIN ?? resolve(import.meta.dirname, "../../plugin") }],
      disallowedTools: DENIED,
      mcpServers: { boulot: boulotTools(vaultRoot, rendererPath, cwd) },
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

                /*
                 * You cannot answer a question nobody asked.
                 *
                 * The employer's questions arrive one way: the user pastes them
                 * into the Questions tab, which is what creates
                 * application-answers.md. So the file existing is the only
                 * evidence that questions were ever asked, and creating it is
                 * never the agent's job.
                 *
                 * On the Clera application the agent offered to draft a cover
                 * note, was told yes, and wrote a cover letter into
                 * application-answers.md. Both artifacts are prose about why
                 * this company, so the model treated the two files as
                 * interchangeable. They are not: the Questions tab then showed
                 * a cover letter, the cover-letter step stayed unticked, and
                 * the real cover letter did not exist.
                 *
                 * A skill saying which file is which is advice. This is the
                 * same rule as a fact about the file system, so the model gets
                 * told where the text actually goes.
                 */
                if (
                  basename(abs) === "application-answers.md" &&
                  !existsSync(abs) &&
                  (i.tool_name === "Write" || i.tool_name === "Edit")
                ) {
                  onEvent({
                    t: "tool",
                    name: i.tool_name ?? "?",
                    label: "Refused: no questions have been pasted for this application",
                  });
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "deny" as const,
                      permissionDecisionReason:
                        `${basename(abs)} does not exist, which means the employer has asked no ` +
                        `questions: that file is only ever created by the user pasting their ` +
                        `questions in. Do not create it. If you are writing a cover letter or a ` +
                        `"why this company" note, it belongs in cover-letter.md in the same folder.`,
                    },
                  };
                }

                if (insideVault(vaultRoot, abs)) return { continue: true };

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
                refusals += 1;

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
                    /*
                     * Firmer each time.
                     *
                     * One run spent eight of its eighteen steps opening files
                     * from Claude Code's own memory directory, being refused,
                     * and then searching the vault for them. The first message
                     * explained the boundary; it did not say stop, so the model
                     * kept trying different spellings of the same mistake.
                     */
                    permissionDecisionReason:
                      refusals >= 2
                        ? `${path} is outside the vault and so were your last ${refusals} attempts. ` +
                          `These files do not exist here and searching for them will not find them. ` +
                          `Stop looking and continue with what is in ${cwd}.`
                        : `${path} is outside the vault. The vault root is ${vaultRoot} and you are ` +
                          `in ${cwd}. Use a path inside it. Ignore any absolute path you have seen ` +
                          `in documentation or in another tool's memory, it does not apply here.`,
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
