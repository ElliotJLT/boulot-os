import { useCallback, useEffect, useRef, useState } from "react";
import { BuildProgress, Markdown, Thinking, collapse } from "./Activity.js";
import { PrepDoc } from "./Prep.js";
import { longDate } from "./dates.js";
import { useSocket } from "./socket.js";
import { AGENTS, MODELS, type AgentKey } from "./models.js";

/**
 * The application workbench.
 *
 * Not a chat. An application has a known shape (a tailored CV, a cover letter,
 * answers to their questions, a rendered PDF) so the interface is a checklist
 * with a play button, and the documents fill in as the agent works. Chat is the
 * fallback for tweaks, not the primary way to get anything done.
 *
 * The previous version opened on an empty editor and a chat prompt, which is a
 * dead end: the user had just logged a role and had nothing to react to.
 */

type Fit = {
  fits: boolean;
  pages: number;
  overflowMm: number;
  trimTarget: { section: string; charactersToCut: number } | null;
  /** The voice check, measured by the renderer rather than claimed in prose. */
  voice?: { dashes: number; words: string[]; summaryWords: number };
};
type Doc = { key: string; label: string; file: string; exists: boolean; chars: number };
type Event =
  | { t: "text"; text: string }
  | { t: "tool"; name: string; label: string }
  | { t: "file"; path: string }
  | { t: "result"; cost: number; error: boolean }
  | { t: "error"; message: string };

/**
 * What every application needs, and nothing else.
 *
 * A cover letter and a set of answers used to be part of the build, so every
 * run wrote both whether or not the employer had asked for either. Artificial
 * Societies wanted neither, and it got both: two documents nobody reads, paid
 * for in tokens and in the minutes spent watching them being written.
 *
 * Both are one click away below. Making them opt-in costs a click on the
 * applications that want them and saves the work on the ones that do not.
 */
/**
 * What always happens, and is therefore not a question.
 *
 * These were tickboxes, which asked whether you wanted a CV from a tool whose
 * entire purpose is producing one. A checkbox that is always ticked is not a
 * choice, it is a claim that you had one. The adversarial review joined them:
 * it is the part of this that is actually worth having, and offering to skip it
 * invited people to skip the only step that makes the draft better.
 */
const STEPS = [
  { key: "cv", label: "Tailor the CV", verb: "Tailoring the CV" },
  { key: "review", label: "Stress-tested by three reviewers", verb: "Three reviewers are reading it" },
  { key: "pdf", label: "Render the PDF", verb: "Rendering the PDF" },
] as const;

/**
 * Asked for per application, because most applications ask for neither.
 *
 * These sit in the build list as unticked boxes rather than as buttons
 * elsewhere. One place says what play will do, and ticking a box is how you
 * change it. The previous arrangement had the CV tab promising "press play and
 * Boulot will write it" on a document play was never going to write.
 */
/**
 * The two things most applications do not ask for.
 *
 * Buttons rather than boxes. A tickbox implies a default, and both of these
 * default to no: most postings want a CV and nothing else, and a cover letter
 * nobody asked for is tokens spent on a document nobody reads.
 */
const EXTRAS = [
  { key: "cover", label: "Cover letter", verb: "Drafting the cover letter" },
  { key: "questions", label: "Their questions", verb: "Answering their questions" },
] as const;

/**
 * Extras that produce no file of their own.
 *
 * The review panel changes the CV rather than adding a document, so it never
 * counts as "done" and never earns a tab. It stays a box you can tick, which is
 * the right shape anyway: it is the single most expensive thing in the app.
 */
const NO_DOCUMENT = new Set(["review"]);

/** Documents that are read rather than edited, so they render rather than sit in a textarea. */
/* Reference, not drafts. prep is neither: it renders and it saves. */
const READ_ONLY = new Set(["job", "research"]);

/**
 * How an application ended.
 *
 * Five options, not a free-text box. The outcome is the funnel's denominator,
 * and a field that accepts "didn't hear back", "ghosted" and "no response" as
 * three different answers cannot be counted.
 */
const OUTCOMES = [
  { key: "rejected", label: "Rejected" },
  { key: "ghosted", label: "No reply" },
  { key: "withdrawn", label: "I withdrew" },
  { key: "offer_declined", label: "Declined offer" },
  { key: "offer_accepted", label: "Accepted" },
] as const;

/**
 * Tabs in two groups: what you will send, and what it was built from.
 *
 * Flat, they mixed outputs with source material, so the CV sat next to the job
 * description as though they were the same kind of thing. The PDF now sits
 * beside the CV because it is the same document in the form you actually judge.
 * Labels are short: the group tells you what these are.
 */
const OUTPUTS = [
  { key: "cv", label: "CV" },
  { key: "pdf", label: "PDF" },
] as const;

/**
 * Yours and its, in the same file.
 *
 * prep.md is the one artifact an interview needs and the only one both sides
 * write to: ask the agent something and the answer lands here, type your own
 * note and it sits next to it. A pane you can only read is a transcript, and a
 * transcript is not what you take into the room.
 */
const PREP = { key: "prep", label: "Prep" } as const;

const SOURCES = [
  { key: "job", label: "JD" },
  { key: "research", label: "Research" },
] as const;

/**
 * The prep work worth doing, as one-click asks.
 *
 * Not a checklist with a play button. A checklist implies a sequence you work
 * through and a state you can be behind on, and preparing for an interview is
 * not that: you do the two or three that apply to this call and ignore the
 * rest. These are shortcuts for questions the user would otherwise type out,
 * which is the only reason they exist.
 *
 * Every one of them was asked for out loud while preparing for a real
 * interview, rather than invented as a feature. That is the bar for adding
 * another.
 */
const PREP_ACTIONS: Array<{ label: string; hint: string; ask: string; covers: string[] }> = [
  {
    label: "What are they building",
    covers: ["what they are actually building"],
    hint: "The problem underneath the marketing, and why it is hard",
    ask:
      "What is this company actually building? Not their marketing sentence: the problem " +
      "underneath it, why it is technically hard, and what breaks for a user when it goes " +
      "wrong. Name the specific techniques or datasets involved if you can find them.",
  },
  {
    label: "Brief me on the stack",
    covers: ["technical brief", "if it comes up"],
    hint: "Basics I could be quizzed on, assuming I am new to it",
    ask:
      "Brief me on the technologies in this job description as though I have never used them. " +
      "Plain language, short examples, and flag the one or two questions I am most likely to " +
      "be asked. End with an honest line I can say about my actual level.",
  },
  {
    label: "Why we chose what we chose",
    covers: ["the \"why\" answers", "why answers"],
    hint: "Defensible reasons for my own past technical decisions",
    ask:
      "Go through the technical decisions in my own past work and give me the defensible " +
      "reasons behind each one, so I can answer 'why did you use that'. Give me options to " +
      "pick from rather than one answer, and say which ones connect to this company's problem.",
  },
  {
    label: "Competitors and casualties",
    covers: ["competitors and casualties", "the graveyard"],
    hint: "Who else tried this, and what happened to them",
    ask:
      "Who else has tried to solve this problem, and what happened to them? Include the " +
      "failures and what actually killed them, not just the survivors. Then say how this " +
      "company's approach differs, and what question that leaves unanswered.",
  },
  {
    label: "My work that connects",
    covers: ["already built in this", "work that connects"],
    hint: "Side projects and past work in their domain",
    ask:
      "Search my vault and my own projects for anything in this company's domain or that " +
      "solves the same shape of problem. Tell me what to lead with, and how to raise it " +
      "without it sounding like a pitch.",
  },
  {
    label: "Who I am meeting",
    covers: ["facts, checked", "who i am meeting"],
    hint: "The interviewer and the company, checked today",
    ask:
      "Who am I likely to be meeting, what should I know about them and the company, and what " +
      "does their background suggest about the kind of interview this will be? Verify anything " +
      "date-dependent against a live source and say when you could not.",
  },
  {
    label: "Questions to ask",
    covers: ["what to ask them", "questions to ask"],
    hint: "Ones that are genuinely unanswered, not a quiz",
    ask:
      "Give me questions to ask them. Every one must be genuinely unanswered — if the answer " +
      "is on their site, in a press release or in the job description, it is a quiz and they " +
      "will know it. Each should reveal a tradeoff I understand, and each should have an " +
      "answer that changes whether I would take the job or what I would do first. Give me a " +
      "follow-up for each, and say what each one signals about me.",
  },
  {
    /*
     * Two that act on the document rather than adding to it.
     *
     * A prep document written a week ago and edited twice since is the one
     * most likely to be out of date and the one nobody rewrites, because
     * rewriting it means reading all of it first. Both of these are explicitly
     * non-destructive: the failure mode of an agent editing a document you have
     * been working in is that your own sentences quietly disappear, and once
     * that happens once you stop trusting it with the file.
     */
    label: "Update it",
    hint: "Re-check against reality, correct what has gone stale",
    covers: [],
    ask:
      "Re-check this document against the job description, the research and anything you can " +
      "verify now. Correct what has become wrong, add what is genuinely new, and leave the rest " +
      "exactly as it is: this is a correction pass, not a rewrite. Never touch anything under a " +
      "heading called \"My notes\" — that section is mine. Say what you changed and why, one " +
      "line per change.",
  },
  {
    label: "Fold it in",
    hint: "Absorb what I pasted, cut what does not earn its place",
    covers: [],
    ask:
      "I dump raw material into this document as I find it. Your job is to fold it into the " +
      "document and get rid of what does not earn its place. Be bold. Assume I want this " +
      "shorter and sharper when you are done, not longer.\n\n" +
      "Anything pasted in from elsewhere — a bio, a job advert, an article, an email, a " +
      "transcript — is raw input, not part of the document. Work out what it actually tells me " +
      "that changes how I should behave in the room, write that into the section where it " +
      "belongs, and delete the raw text. Do not keep it out of caution and do not park it at the " +
      "bottom under a new heading: absorbed means gone.\n\n" +
      "If it tells me nothing that changes what I would say or do, say so and delete it anyway. " +
      "In the rest of the document, collapse repetition and cut anything a later section has " +
      "superseded. Keep every fact, figure and drafted line I would say out loud.\n\n" +
      "The one thing you never touch is anything under a heading called \"My notes\". That " +
      "section is mine. Everything else in the file is yours to reorganise.\n\n" +
      "Tell me what you cut and roughly how much shorter it got.",
  },
  {
    label: "Grill me",
    covers: [],
    hint: "A hostile mock interview, no encouragement",
    ask:
      "Run a mock interview for this role. Be genuinely tough. Interrupt vague answers, ask " +
      "'what was the number' when a claim has none, and ask the hostile follow-up. Do not be " +
      "encouraging. One question at a time.",
  },
];

/**
 * The stage sequence, as a person would say it.
 *
 * The same three words the board's columns use, because a card that lives in
 * Interviewing and a header that says "screening" are two names for one fact.
 */
const STAGE_ORDER = ["drafting", "applied", "interviewing"] as const;

const STAGE_LABEL: Record<string, string> = {
  lead: "Prep",
  drafting: "Prep",
  applied: "Applied",
  screening: "Interviewing",
  interviewing: "Interviewing",
  offer: "Interviewing",
  "closed-won": "Closed",
  "closed-lost": "Closed",
};

/**
 * Line icons, inline.
 *
 * Four shapes at one weight, drawn here rather than pulled from a set: an icon
 * library is 40kB and a build step to draw a bin, and every icon in this app
 * sits next to a word that already says what it does.
 */
function Icon({ name }: { name: "download" | "refresh" | "archive" | "chevron" | "doc" | "expand" | "collapse" | "copy" | "tick" }) {
  const paths: Record<string, string> = {
    download: "M8 2v8m0 0 3-3m-3 3L5 7M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1",
    refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13 2v3h-3",
    archive: "M2.5 5.5h11m-10 0v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7m-7 0v-2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 8v3m3-3v3",
    chevron: "m4.5 6.5 3.5 3 3.5-3",
    doc: "M9 1.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5m-4-3.5L12.5 5m-4-3.5V4a1 1 0 0 0 1 1h3",
    /*
     * Two arrows on the diagonal, pointing out and pointing in.
     *
     * The first attempt drew four corner brackets, which is the "fullscreen"
     * glyph and reads as neither direction. An arrow has to have a head and a
     * tail or it is a decoration.
     */
    expand: "M6.5 2.5H2.5v4M2.5 2.5 6.5 6.5M9.5 13.5h4v-4M13.5 13.5 9.5 9.5",
    collapse: "M2.5 6.5h4v-4M6.5 6.5 2.5 2.5M13.5 9.5h-4v4M9.5 9.5l4 4",
    copy: "M5.5 5.5V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2.5M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z",
    tick: "m3 8.5 3.5 3.5L13 4.5",
  };
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden focusable="false">
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * What you asked, with the pasted material folded back up.
 *
 * The composer collapses a big paste to a chip, and then sending it unrolled a
 * thousand words into the transcript anyway. The point of collapsing was to
 * keep the conversation readable, and the conversation is mostly the record of
 * what was said rather than the box you say it in: a recruiter's whole email
 * sitting above your one-line question is the same problem one screen later.
 *
 * The text is unchanged. It is stored whole, sent whole, and written whole into
 * conversation.md. Only this view folds it.
 */
function Asked({ text }: { text: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const parts: Array<{ name: string; body: string }> = [];
  const typed = text
    .replace(/<pasted name="([^"]*)">\n?([\s\S]*?)\n?<\/pasted>/g, (_m, name: string, body: string) => {
      parts.push({ name, body });
      return "";
    })
    .trim();

  return (
    <div className="asked">
      {typed && <p className="asked-text">{typed}</p>}
      {parts.length > 0 && (
        <div className="attached">
          {parts.map((a, i) => (
            <span key={i} className="chip-file">
              <button
                className="chip-open"
                title={`${a.body.length.toLocaleString()} characters. Click to read it.`}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <Icon name="doc" />
                {a.name}
                <em>{Math.max(1, Math.round(a.body.length / 100) / 10)}k</em>
              </button>
            </span>
          ))}
        </div>
      )}
      {open != null && <pre className="attached-peek">{parts[open]?.body}</pre>}
    </div>
  );
}

/** Frontmatter is plumbing; it should not be the first thing you read. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  return end === -1 ? md : md.slice(end + 4).replace(/^\n+/, "");
}

export function Workbench({
  who,
  slug,
  company,
  onClose,
  onArchived,
}: {
  who: string;
  slug: string;
  company: string;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const [filing, setFiling] = useState(false);
  const [lesson, setLesson] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  /** Extras the user has ticked. Play produces exactly the ticked list. */
  const [include, setInclude] = useState<Set<string>>(new Set());
  const talkingRef = useRef(false);
  const [stage, setStage] = useState("");
  const [appliedDate, setAppliedDate] = useState<string | null>(null);
  const [interviewDate, setInterviewDate] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);
  /*
   * Big pastes become attachments, not text in the box.
   *
   * Pasting a job description or a recruiter's email into a two-line composer
   * buries the box under a thousand words: you cannot see what you are typing,
   * you cannot see the conversation above it, and the one sentence you actually
   * wanted to add is somewhere in the middle of somebody else's prose.
   *
   * The text is kept whole and sent whole. Only the display collapses.
   */
  const [attached, setAttached] = useState<Array<{ id: number; name: string; text: string }>>([]);
  const [openAttachment, setOpenAttachment] = useState<number | null>(null);
  /*
   * Room to read, when reading is what you are doing.
   *
   * The two panes are sized for the case where you are working with the agent.
   * Reading a prep document or a job description is a different posture: the
   * conversation is not doing anything, and the document is running at about
   * sixty characters a line inside half a window.
   *
   * Remembered per browser, like the agent choice, because how wide you like
   * your reading is a fact about you rather than about this application.
   */
  const [wide, setWide] = useState(() => localStorage.getItem("boulot.wide") === "1");
  const toggleWide = () => {
    setWide((w) => {
      localStorage.setItem("boulot.wide", w ? "0" : "1");
      return !w;
    });
  };
  const [menu, setMenu] = useState(false);
  /** Tabs made for this application: a second round, a task, a panel. */
  const [extra, setExtra] = useState<Array<{ key: string; label: string; exists: boolean }>>([]);
  const [naming, setNaming] = useState(false);
  const [copied, setCopied] = useState(false);
  /*
   * Remembered per browser, not per application.
   *
   * Which agent you want is a fact about how you work, not about this
   * employer, and having to reset it on every screen would make the control
   * cost more than it saves.
   */
  const [agent, setAgent] = useState<AgentKey>(
    () => (localStorage.getItem("boulot.agent") as AgentKey) ?? "thinker",
  );
  const pickAgent = (k: AgentKey) => {
    setAgent(k);
    localStorage.setItem("boulot.agent", k);
  };
  const modelFor = () => AGENTS.find((a) => a.key === agent)?.model ?? MODELS.tailor;
  const composer = useRef<HTMLTextAreaElement>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  // The file name, not a boolean: older applications carry the CV under the
  // download filename rather than cv.pdf, and the viewer has to fetch by name.
  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const pdfExists = Boolean(pdfFile);
  const [fit, setFit] = useState<Fit | null>(null);
  // Opens on the PDF when one exists, because that is the thing you are
  // actually judging. The markdown is how you change it, not how you read it.
  // Only applies until the user picks a tab themselves.
  const [tab, setTab] = useState<string>("cv");
  const chosen = useRef(false);
  const [text, setText] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [flash, setFlash] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [pdfName, setPdfName] = useState("CV.pdf");
  const [justApplied, setJustApplied] = useState(false);

  const [running, setRunning] = useState<string | null>(null);
  /*
   * What is running, not just that something is.
   *
   * The checklist used to animate on any activity, so asking for a small tweak
   * to a finished CV lit up "Tailoring the CV, Drafting the cover letter,
   * Rendering the PDF" and looked exactly like someone had pressed play. A
   * tweak is a conversation about one document; a build is the four steps.
   *
   * "adopted" is a run that started on another screen. Logging a job hands over
   * to this one mid-flight, and the workbench has to be able to narrate work it
   * did not begin.
   */
  const [runKind, setRunKind] = useState<"build" | "tweak" | "adopted" | null>(null);
  const [activity, setActivity] = useState<string[]>([]);
  // Taken from the job, not from this tab, so opening a run already in
  // flight shows how long it has really been going rather than restarting
  // the clock at zero and hiding the very case the clock is there for.
  const [since, setSince] = useState<number | null>(null);
  /*
   * Both sides of the conversation, in order.
   *
   * This was an array of the agent's replies, so what you asked for vanished
   * the moment you pressed Send and the answer arrived with no question above
   * it. Half a transcript is worse than none: you cannot tell which reply
   * belongs to which request, and after two exchanges you cannot remember what
   * you asked.
   */
  const [turns, setTurns] = useState<Array<{ who: "you" | "boulot"; text: string }>>([]);
  const [ask, setAsk] = useState("");
  const [cost, setCost] = useState(0);
  const [pdfKey, setPdfKey] = useState(0);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const refresh = useCallback(async () => {
    const d = await fetch(`/api/${who}/job/${slug}/docs`).then((r) => r.json());
    setDocs(d.docs ?? []);
    setExtra(d.extra ?? []);
    setPdfFile(d.pdf ?? null);
    /*
     * Open on the thing this stage is about.
     *
     * The PDF is the right landing tab while an application is being built,
     * because the rendered CV is what you are judging. Once someone has replied
     * it is the wrong one: you are not looking at the CV any more, you are
     * preparing for a conversation, and Prep was two clicks away every single
     * time.
     */
    const st = String(d.stage ?? "");
    const talkingNow = ["screening", "interviewing", "offer"].includes(st);
    const huntingNow =
      st === "lead" && !d.docs?.some((x: Doc) => x.key === "job" && x.exists);
    if (!chosen.current) {
      if (talkingNow && d.docs?.some((x: Doc) => x.key === "prep" && x.exists)) {
        chosen.current = true;
        tabRef.current = "prep";
        setTab("prep");
      } else if (huntingNow) {
        // Same argument as Prep: land on the only document that can exist
        // here. The CV tab on a company with no advert is an empty box
        // offering to tailor against nothing.
        chosen.current = true;
        tabRef.current = "outreach";
        setTab("outreach");
      } else if (d.pdf) {
        chosen.current = true;
        tabRef.current = "pdf";
        setTab("pdf");
      }
    }
    setFit(d.fit ?? null);
    setStage(st);
    setAppliedDate((d.appliedDate as string | null) ?? null);
    setInterviewDate((d.interviewDate as string | null) ?? null);
    if (d.downloadName) setPdfName(String(d.downloadName));
    // Always keep cv and job in memory: the tweak box attaches them regardless
    // of which tab is showing, and the PDF tab has no markdown of its own.
    const active = tabRef.current;
    const needed = [
      ...new Set([
        active === "pdf" ? "cv" : active,
        "cv",
        "job",
        // The prep conversation attaches these whatever tab is showing.
        ...(d.stage && d.stage !== "drafting" && d.stage !== "lead" ? ["research", "prep"] : []),
      ]),
    ];
    const loaded = await Promise.all(
      needed.map((k) =>
        fetch(`/api/${who}/job/${slug}/doc/${k}`)
          .then((r) => r.json())
          .then((d) => [k, d.markdown ?? ""] as const),
      ),
    );
    if (dirtyRef.current) return;
    setText((t) => ({ ...t, ...Object.fromEntries(loaded.filter(([k]) => k !== active)) }));
    const doc = { markdown: loaded.find(([k]) => k === active)?.[1] ?? "" };
    if (active === "pdf") return;
    setText((t) => {
      // Flash the pane when the agent changes what you are looking at, so it is
      // obvious something arrived rather than silently swapping underneath.
      if (t[active] !== undefined && t[active] !== doc.markdown) {
        setFlash(true);
        setTimeout(() => setFlash(false), 800);
      }
      return { ...t, [active]: doc.markdown ?? "" };
    });
  }, [who, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh, tab]);

  /*
   * Catch up on a run that started before this screen opened.
   *
   * Logging a job hands over to the workbench mid-flight, and leaving the page
   * and coming back should not look like nothing happened. The server keeps the
   * events, so arriving late is a replay rather than a blank panel.
   */
  useEffect(() => {
    void fetch("/api/jobs")
      .then((r) => r.json())
      .then(
        (d: {
          jobs: Array<{
            slug: string | null;
            label: string;
            running: boolean;
            startedAt?: number;
            events: Event[];
          }>;
        }) => {
        const mine = d.jobs.find((j) => j.slug === slug);
        if (!mine) return;
        setActivity(mine.events.filter((e) => e.t === "tool").map((e) => (e as { label: string }).label));
        setTurns(
          mine.events
            .filter((e) => e.t === "text")
            .map((e) => ({ who: "boulot" as const, text: (e as { text: string }).text })),
        );
        if (mine.running) {
          setRunning(mine.label);
          setRunKind("adopted");
          setSince(mine.startedAt ?? Date.now());
        }
      })
      .catch(() => {});
  }, [slug]);

  /*
   * Resync on reconnect.
   *
   * A restarted server means the run this screen was watching is gone, and the
   * checklist and the log are both describing a moment that has passed. The
   * jobs endpoint is the truth, so it is asked again rather than guessed at.
   */
  const resync = useCallback(() => {
    void fetch("/api/jobs")
      .then((r) => r.json())
      .then(
        (d: {
          jobs: Array<{ slug: string | null; label: string; running: boolean; startedAt?: number }>;
        }) => {
        const mine = d.jobs.find((j) => j.slug === slug);
        if (mine?.running) {
          setRunning(mine.label);
          setRunKind((k) => k ?? "adopted");
          setSince((s) => s ?? mine.startedAt ?? Date.now());
        } else {
          // Nothing is running any more, whatever this screen still believes.
          setRunning(null);
          setRunKind(null);
          setSince(null);
        }
        void refresh();
      })
      .catch(() => {});
  }, [slug, refresh]);

  const { status: connection, send: emit } = useSocket((raw) => {

      const ev = raw as Event;
      /*
       * Only this application's work.
       *
       * With three runs able to go at once, an unfiltered stream would splice
       * another company's research into this one's log. Events carry the job
       * they belong to; anything else is somebody else's business.
       */
      const forUs = (ev as { job?: string; slug?: string }).slug === slug ||
        (ev as { job?: string }).job === slug;
      if (!forUs) return;
      if ((ev as { t: string }).t === "job") {
        const j = ev as unknown as { running: boolean; label?: string };
        setRunning(j.running ? (j.label ?? "Working") : null);
        setRunKind((k) => (j.running ? (k ?? "adopted") : null));
        setSince((s) => (j.running ? (s ?? Date.now()) : null));
        if (!j.running) void refresh();
        return;
      }
      if (ev.t === "tool") {
        setActivity((a) => [...a, ev.label]);
        // Work arriving with nothing running locally means another screen
        // started it and handed this one the job of showing it.
        setRunning((r) => r ?? "Working");
        setRunKind((k) => k ?? "adopted");
      }
      else if (ev.t === "file") {
        setActivity((a) => [...a, `Saved ${ev.path.split("/").pop()}`]);
        /*
         * Show the document being written, unless the user has picked a tab.
         *
         * Watching research appear is the whole reason to be on this screen
         * while a run is going. Never overrides a deliberate choice.
         */
        const name = ev.path.split("/").pop() ?? "";
        const tabFor: Record<string, string> = {
          "research.md": "research",
          "job.md": "job",
          "cv.md": "cv",
          "cover-letter.md": "cover",
          "application-answers.md": "questions",
        };
        const next = tabFor[name];
        if (next && !chosen.current) {
          tabRef.current = next;
          setTab(next);
        }
        void refresh();
      } else if (ev.t === "text") setTurns((t) => [...t, { who: "boulot", text: ev.text }]);
      else if (ev.t === "error") setTurns((t) => [...t, { who: "boulot", text: ev.message }]);
      else if (ev.t === "result") {
        setRunning(null);
        setRunKind(null);
        setSince(null);
        setCost((c) => c + ev.cost);
        setPdfKey((k) => k + 1);
        void refresh();
      }
  }, resync);


  const send = (
    prompt: string,
    label: string,
    kind: "build" | "tweak" = "build",
    model: string = MODELS.tailor,
    /** What the user asked, in their words, for the conversation log. */
    note?: string,
  ) => {
    if (running) return;
    setRunKind(kind);
    setRunning(label);
    setSince(Date.now());
    setActivity([]);
    if (!emit({ prompt, person: who, job: slug, slug, label, model, note })) {
      // The socket is down. Saying so beats a spinner that never resolves.
      setRunning(null);
      setRunKind(null);
      setSince(null);
      setTurns((t) => [...t, { who: "boulot", text: "Lost the connection to Boulot. Reconnecting; try again in a moment." }]);
      return;
    }
  };

  /**
   * File the application away.
   *
   * Nothing is deleted: the folder moves to `archive/`, which the funnel and
   * the career record both still read. Closing back to the board afterwards is
   * the point of the whole feature, so it happens without asking again.
   */
  /**
   * Throw away the drafts and start the writing again.
   *
   * Keeps the job description and the research, which cost web searches and
   * minutes to gather and are not what went wrong. Confirmed once, because it
   * deletes work, and unlike archiving it is not reversible.
   */
  const reset = async () => {
    if (running) return;
    if (!confirm("Delete the CV, cover letter, answers and PDF for this application?\n\nThe job description and research are kept.")) return;
    await fetch(`/api/${who}/job/${slug}/reset`, { method: "POST" });
    setText((t) => ({ ...t, cv: "", cover: "", questions: "" }));
    setInclude(new Set());
    chosen.current = false;
    setTab("cv");
    await refresh();
  };

  /** Record that it went out, and let the board work out the date. */
  const addTab = async (raw: string) => {
    const name = raw.trim();
    setNaming(false);
    if (!name) return;
    const d = await fetch(`/api/${who}/job/${slug}/doc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (!d?.key) return;
    chosen.current = true;
    setTab(d.key);
    /*
     * Making the tab is the ask.
     *
     * Two buttons used to mean "write me this document": a + in the rail for
     * the two hardcoded extras, and a + in the tab strip for everything else.
     * One of them queued the document for the next run and the other made an
     * empty file and waited to be asked again, which is the same confusion
     * that had a brand-new "Stack basics" tab sitting empty beside a long
     * answer in the conversation.
     *
     * So there is one +, it lives with the tabs, and adding one puts the
     * document in the plan. Only while the documents are still being written:
     * once someone has replied, a new tab is a place to keep notes for a round
     * that has not happened yet, and play is not what writes those.
     */
    if (!talkingRef.current) setInclude((prev) => new Set(prev).add(d.key));
    void refresh();
  };

  const saveInterviewDate = async (date: string) => {
    setInterviewDate(date || null);
    setEditingDate(false);
    await fetch(`/api/${who}/job/${slug}/interview-date`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date }),
    }).catch(() => {});
    void refresh();
  };

  const setStageTo = async (next: string) => {
    await fetch(`/api/${who}/job/${slug}/stage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage: next }),
    });
    setStage(next);
    setMenu(false);
    void refresh();
    if (next !== "applied") return;
    /*
     * Say it happened.
     *
     * The button vanished and nothing else changed, so the only evidence the
     * click had worked was the absence of the thing you clicked. Pressing
     * submit on someone's form is the point of the whole exercise; it deserves
     * an acknowledgement rather than a disappearance.
     */
    setJustApplied(true);
    onArchived?.();
  };

  const archive = async (outcome: string | null) => {
    const r = await fetch(`/api/${who}/job/${slug}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome, notes: lesson.trim() }),
    });
    setFiling(false);
    if (!r.ok) {
      setTurns((t) => [...t, { who: "boulot", text: "Could not archive that. It may already be filed." }]);
      return;
    }
    onArchived?.();
    onClose();
  };

  /*
   * Talking to them is the line, not sending it.
   *
   * Prep mode first triggered at "applied", which is a day too early: most
   * applications never get a reply, and switching the panel to interview
   * preparation the moment something goes out prepares you for a conversation
   * that in the median case never happens. It also took away the checklist
   * while the CV was still the only thing that mattered.
   *
   * So an applied application keeps the build view. Once somebody replies —
   * screen, interview, offer — the documents are settled and the only work
   * left is the conversation, and that is when the panel changes.
   */
  const talking = ["screening", "interviewing", "offer"].includes(stage);
  // addTab is defined above this and closes over it, so it reads the ref.
  talkingRef.current = talking;
  const sent = talking || stage === "applied" || justApplied;

  /*
   * A company, with no job to apply for.
   *
   * The three build steps assume a posting exists: tailor the CV *to what*,
   * render a PDF to send *where*. A lead with no job.md is the case where the
   * best move is to reach the founder two to five months after a raise, while
   * the need is real and the advert is not written — and the rail was offering
   * to tailor a CV against nothing.
   *
   * Keyed on the absence of a job description rather than on the stage,
   * because a lead that has a posting is just an application nobody has
   * started, and that one wants the build rail exactly as it is.
   */
  const hunting = !sent && !(text.job ?? "").trim();

  const done = (key: string) =>
    key === "pdf" ? pdfExists : Boolean(docs.find((d) => d.key === key)?.exists);
  const allDone = STEPS.every((s) => done(s.key));
  const hasResearch = Boolean(text.research?.trim());

  /*
   * What play will do, in the order it will do it.
   *
   * The rail used to render the three fixed steps and then the requested
   * extras underneath, while the run put the extras in the middle — so a
   * ticked cover letter was listed after "Render the PDF" and written before
   * it. Nobody would notice until the run, and then the ticks would light up
   * out of order. One array now, read by both.
   *
   * The order itself is load-bearing: a cover letter written before the CV
   * argues from the master record rather than the tailored one, the review
   * has to see everything, and the PDF renders a CV that is about to change
   * if it goes any earlier.
   */
  const asked = [
    ...EXTRAS.filter((e) => include.has(e.key) || done(e.key)),
    ...extra
      .filter((e) => include.has(e.key))
      .map((e) => ({ key: e.key, label: e.label, verb: `Writing ${e.label.toLowerCase()}` })),
  ];
  const railPlan = [STEPS[0], ...asked, STEPS[1], STEPS[2]];

  /**
   * Produce one of the optional documents.
   *
   * Questions is deliberately not run from here: the tab opens empty so the
   * user can paste what the employer actually asked, and the play button then
   * answers those. Guessing the questions from the job description produces
   * confident answers to questions nobody asked.
   */
  const askFor = (key: string) => {
    if (running || key !== "cover") return;
    send(
      `For the application in active/${slug}, use the boulot:application-answers skill to write a ` +
        `cover letter to active/${slug}/cover-letter.md. Read cv.md, job.md and research.md first.`,
      "Writing the cover letter",
      // Not a build. Passing no kind defaulted to one, which is why asking for
      // a cover letter made the CV and PDF steps animate as though the whole
      // application were being rebuilt.
      "tweak",
      MODELS.writing,
    );
  };

  const runAll = async () => {
    /*
     * Save first.
     *
     * Questions are pasted into the tab and then the run reads them off disk,
     * so an unsaved paste would have the agent answering the previous contents
     * of the file, or an empty one.
     */
    if (dirty) await save();
    /*
     * The CV first, then the extras, then the PDF.
     *
     * A cover letter written before the CV argues from the master record rather
     * than from the tailored one, and the PDF has to come last or it renders a
     * CV that is about to change.
     */
    /*
     * The same list the rail is showing, so the two cannot disagree.
     *
     * Cover letter and Questions are in it because they are the two everybody
     * needs, not because they are a closed set: a tab called "Diversity
     * statement" or "Portfolio note" is the same kind of thing, and until now
     * the only documents play could produce were the two whose names were
     * compiled into the source.
     */
    // CV, then anything extra, then the review, then the render. The review
    // reads whatever was written, so it has to come after all of it.
    const plan = railPlan as ReadonlyArray<{
      key: string;
      label: string;
      verb: string;
    }>;

    /*
     * A ticked box is the instruction. Do not second-guess it with the file
     * system.
     *
     * This filtered every step whose document already existed, which is right
     * for the CV and wrong for the extras. Pasting the questions into the
     * Questions tab creates application-answers.md, so the file existed, so
     * "Answer their questions" counted as done and was dropped from the plan
     * before the run started. The questions were pasted, the box was ticked,
     * the run went ahead, and nothing answered them.
     *
     * The CV and the PDF still skip when they exist, because there Start over
     * is the way to redo them. An extra you have just asked for is not
     * something you have already got.
     */
    const missing = plan.filter((s) => {
      const optional = !STEPS.some((f) => f.key === s.key);
      return optional ? include.has(s.key) : !done(s.key);
    });
    if (!missing.length) return;
    /*
     * Hand it the documents rather than making it find them.
     *
     * One measured run cost $5.90 and spent it like this: nine vault searches,
     * the job description read four times, the career record three times, the
     * CV it had just written three times. The files never changed during the
     * run. Attaching them inline is the same trick the tweak box already uses,
     * and it is cheaper than the tool calls it replaces because the prefix
     * caches.
     */
    const attach = (label: string, body: string, file: string) =>
      body.trim() ? `\n\n<${label} path="active/${slug}/${file}">\n${body.trim()}\n</${label}>` : "";

    const instruction = (key: string) =>
      key === "cv"
        ? `Use the boulot:tailor-cv skill to write active/${slug}/cv.md. Show the JD mapping table.`
        : key === "cover"
          ? `Use the boulot:application-answers skill to write a cover letter to active/${slug}/cover-letter.md.`
          : key === "questions"
            ? `active/${slug}/application-answers.md already contains the employer's questions and no answers. Write an answer beneath each question, in that same file, keeping the questions in place. Answer only the questions written there and do not invent others.`
            : key === "review"
              ? `Run the three adversarial reviewers described in boulot:tailor-cv, then apply their edits to cv.md.`
              : key === "pdf"
                ? `Call boulot_render_pdf on active/${slug}/cv.md and report the fit.`
                : /*
                   * A tab whose name is the whole brief.
                   *
                   * Nothing here knows what "Diversity statement" or "Take-home
                   * plan" is meant to contain, and it does not need to: the
                   * person naming the tab knew, and anything they had already
                   * put in it is the rest of the answer. Saying so beats
                   * guessing a template.
                   */
                  `Write active/${slug}/${key}.md. It is titled "${
                    extra.find((e) => e.key === key)?.label ?? key
                  }" and that title is the brief. Anything already in the file is the ` +
                  `user's own material — a spec, a paste, their notes — so treat it as input ` +
                  `and build around it rather than replacing it. Use the boulot:application-answers ` +
                  `skill for the writing, and keep it to what the title actually asks for.`;

    send(
      `For the application in active/${slug}, do these in order:\n\n` +
        missing.map((s, i) => `${i + 1}. ${instruction(s.key)}`).join("\n") +
        `\n\nThe job description is included below, so you do not need to open it. ` +
        `Read cv-master.md once for the evidence bank, and research.md once if you ` +
        `need the company angle. Do not re-read a file you have already read in ` +
        `this run, and do not search the vault for reference CVs: the master ` +
        `record is the source.` +
        attach("job_description", text.job ?? "", "job.md") +
        `\n\nKeep commentary short.`,
      "Building the application",
      "build",
      MODELS.tailor,
      `Build: ${missing.map((m) => m.label.toLowerCase()).join(", ")}`,
    );
  };

  /*
   * Save on its own, shortly after you stop typing.
   *
   * Pasting questions into a box and then having to find a Save button is the
   * kind of step that exists only because the code found it convenient. The
   * documents are files on disk with no other reader, so there is nothing to
   * conflict with and nothing to lose by writing them.
   *
   * Debounced rather than per-keystroke: a write per character would be a lot
   * of pointless disk traffic and would make every keypress a network call.
   */
  useEffect(() => {
    if (!dirty) return;
    const which = tabRef.current;
    const t = setTimeout(() => {
      void fetch(`/api/${who}/job/${slug}/doc/${which}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: text[which] ?? "" }),
      })
        .then(() => {
          setDirty(false);
          /*
           * Editing the CV re-renders the PDF.
           *
           * Without this the preview is whatever the agent last produced, so
           * the moment you fix a line by hand the page beside it is a lie. The
           * renderer needs no model and takes about four seconds, so there is
           * nothing to weigh up: the honest page is free.
           */
          if (which !== "cv") return;
          setRendering(true);
          return fetch(`/api/${who}/job/${slug}/pdf`, { method: "POST" })
            .then((r) => r.json())
            .then((d) => {
              setFit(d.fit ?? null);
              setPdfFile(d.pdf ?? null);
              setPdfKey((k) => k + 1);
            })
            .finally(() => setRendering(false));
        })
        .catch(() => setRendering(false));
    }, 900);
    return () => clearTimeout(t);
  }, [text, dirty, who, slug]);

  const save = async () => {
    await fetch(`/api/${who}/job/${slug}/doc/${tab}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markdown: text[tab] ?? "" }),
    });
    setDirty(false);
    void refresh();
  };

  /**
   * Ask for a change, with the documents attached.
   *
   * The agent used to go and find the CV and the job description before it
   * could answer anything, six steps to read two files that were already open
   * in the browser. It reread each of them twice. Sending the content inline
   * removes the round trip entirely, and it is cheaper than the tool calls it
   * replaces because the prefix caches.
   *
   * The wording of the covering line matters more than it should. An earlier
   * version said "you already have them: do not search for them and do not
   * read them again", meaning do not call the Read tool. The model read it as
   * do not consult this content, and answered questions about the attached CV
   * with "NONE" while the text sat in front of it. Tested: the tag wrapper is
   * fine, attaching the document is fine, and that one sentence is what broke
   * it. Say what is true ("these are included, you do not need to open them")
   * rather than issuing a prohibition that can be read too widely.
   *
   * Sending the editor's content, not the file's, also means an unsaved edit is
   * what gets reasoned about. Reading from disk would have quietly ignored
   * whatever you had just typed.
   */
  /** A prep question, from a button rather than the box. */
  const askPrep = (question: string) => {
    if (running) return;
    setAsk(question);
    // Let the state land before the send reads it.
    setTimeout(() => void tweak(question), 0);
  };

  /** What was typed, plus anything pasted, in the order it arrived. */
  const composed = (typed: string) =>
    attached.length
      ? [
          typed.trim(),
          ...attached.map((a) => `\n<pasted name="${a.name}">\n${a.text}\n</pasted>`),
        ]
          .filter(Boolean)
          .join("\n")
      : typed.trim();

  const tweak = async (override?: string) => {
    const q = composed(override ?? ask);
    if (!q || running) return;
    if (dirty) await save();

    const cv = text.cv ?? "";
    const job = text.job ?? "";
    const attach = (label: string, body: string, file: string) =>
      body.trim() ? `\n\n<${label} path="active/${slug}/${file}">\n${body.trim()}\n</${label}>` : "";

    setTurns((t) => [...t, { who: "you", text: q }]);

    /*
     * A sent application is a different conversation.
     *
     * Handed the CV and told to use Edit, the agent will edit the CV, which is
     * the one thing that must not happen once the employer has it. So past
     * drafting it gets the job description, the research and the prep notes
     * instead, and one place to write.
     */
    if (talking) {
      /*
       * Whichever document you are looking at is the one being written.
       *
       * Prep is the first round. A second round, a take-home or a panel gets a
       * tab of its own, and answers belong in the tab that is open rather than
       * all reverting to prep.md, which would turn one document into a pile of
       * unrelated rounds.
       */
      const target = extra.some((e) => e.key === tab) ? `${tab}.md` : "prep.md";
      const targetName = extra.find((e) => e.key === tab)?.label ?? "Prep";
      send(
        `Use the boulot:prep skill. Application: active/${slug}. This has already been sent ` +
          `and the interview is what is left. Do not edit cv.md, cover-letter.md or ` +
          `application-answers.md, and do not write any new document: the employer already ` +
          `has them.` +
          attach("job_description", job, "job.md") +
          attach("research", text.research ?? "", "research.md") +
          attach("prep_notes", text.prep ?? "", "prep.md") +
          (target !== "prep.md" ? attach("this_round", text[tab] ?? "", target) : "") +
          `\n\nQuestion: ${q}\n\n` +
          (q.includes("> ")
            ? `The quoted passage is from prep.md and is what the question is about. If your ` +
              `answer changes it, edit that passage in place rather than appending a new section ` +
              `saying the same thing differently.\n\n`
            : "") +
          (target === "prep.md"
            ? `Answer in the conversation. Prep is already written, so only write into ` +
              `active/${slug}/prep.md if this genuinely changes what gets said in the room, and ` +
              `then file it into the section it belongs to rather than appending a new one.`
            : /*
               * A tab the user made is an instruction, not a suggestion.
               *
               * Making a tab called "Stack basics" and then asking about the
               * stack inside it says exactly where the answer goes. The rule
               * that most answers stay in the conversation is right for prep,
               * which fills with Q&A otherwise, and wrong here: it produced a
               * long answer in the chat and an empty document beside it, which
               * is the one outcome the tab was created to prevent.
               */
              `Write the answer into active/${slug}/${target}, and summarise it in the ` +
              `conversation rather than repeating it. That file is "${targetName}": the user ` +
              `made this tab for exactly this material, so asking here is an instruction to ` +
              `write there. Build it into a document that stands on its own and reads in order, ` +
              `rather than appending question-and-answer sections. Create it if it is empty.`) +
          ` Never edit anything under a heading called "My notes": that section is the user's.` +
          ` Be specific to this company and this job description. Generic interview advice is ` +
          `worse than nothing, because it reads as preparation and is not.`,
        "Working",
        "tweak",
        modelFor(),
        q,
      );
      setAsk("");
      setAttached([]);
      return;
    }

    send(
      `Application: active/${slug}\n\n` +
        `The current contents of the files are included below, so you do not need to open them. ` +
        `Use Edit to change them.` +
        attach("cv", cv, "cv.md") +
        attach("job_description", job, "job.md") +
        `\n\nRequest: ${q}\n\n` +
        /*
         * The instruction that makes corrections stick.
         *
         * Without it, telling the agent that a bare PR count is a vanity metric
         * teaches it nothing: the run ends and the same note gets made again
         * next week. The bar is deliberately high, because a lessons file that
         * fills with one-off facts about single applications is noise and stops
         * being read.
         */
        `If this request corrects how you should write in general, rather than ` +
        `changing one detail of this application, append a single line to ` +
        `profile/lessons.md saying what to do differently, in the imperative. ` +
        `Create the file if it does not exist. Do not record anything specific ` +
        `to this one employer, and do not record it twice: read the file first ` +
        `and skip if it is already there. If this is a one-off change, do not ` +
        `write anything.`,
      "Working",
      "tweak",
      modelFor(),
      q,
    );
    setAsk("");
    setAttached([]);
  };

  return (
    <div className="bench">
      <header className="bench-top">
        <button className="back" onClick={onClose} title="Back to the board" aria-label="Back to the board">
          ←
        </button>
        <h2>
          {company}
          {(justApplied || stage === "applied") && (
            <span
              className={justApplied ? "applied-tick pop" : "applied-tick"}
              title="Marked as applied"
              aria-label="Applied"
            >
              ✓
            </span>
          )}
        </h2>
        <div className="bench-actions">
          {fit && (
            <span className={`fit ${fit.fits ? "fit-ok" : "fit-over"}`}>
              {/* "2pp" is a typesetter's word. Nobody else has ever used it. */}
              {fit.fits
                ? `${fit.pages} page${fit.pages === 1 ? "" : "s"}`
                : `${fit.pages} pages · ${fit.overflowMm}mm over`}
            </span>
          )}
          {dirty ? (
            <span className="saving">Saving…</span>
          ) : rendering ? (
            <span className="saving">Re-rendering the page…</span>
          ) : null}
          {pdfExists && (
            <a
              className="ghost"
              href={`/api/${who}/job/${slug}/file/${encodeURIComponent(pdfFile ?? "cv.pdf")}`}
              download={pdfName}
            >
              <Icon name="download" />
              Download
            </a>
          )}
          {/*
            Anything regenerable counts.

            This checked only for a CV or a PDF, so an application that had a
            cover letter and nothing else offered no way to start over, which is
            exactly the state a first attempt leaves you in.
          */}
          {(pdfExists || ["cv", "cover", "questions"].some((k) => done(k))) && (
            <button className="ghost" disabled={Boolean(running)} onClick={() => void reset()}>
              <Icon name="refresh" />
              Start over
            </button>
          )}

          {/*
            Where it is, as one control.

            "Mark as applied", "Mark as interviewing" and "Archive" are the same
            question asked three times, and as three buttons they appeared and
            disappeared depending on the answer to it: the header changed shape
            as an application progressed, so the thing you were looking for was
            never where it was last time. One menu holds the whole sequence,
            always in the same place, with the current state written on it.

            Archive is in here too, below a rule, because it is the same
            decision (where has this got to) with a different consequence.
          */}
          <div className="statusmenu">
            <button
              className={`ghost status-trigger${menu ? " on" : ""}`}
              onClick={() => setMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menu}
            >
              <span className={`status-dot stage-${stage || "drafting"}`} />
              {STAGE_LABEL[stage] ?? "Prep"}
              <Icon name="chevron" />
            </button>
            {menu && (
              <>
                {/*
                  Click anywhere to dismiss, which is the only way out people
                  try. A div, not a button: as a button it inherited the header's
                  filled-button styling and painted the entire viewport dark.
                */}
                <div className="menu-scrim" onClick={() => setMenu(false)} />
                <div className="menu" role="menu">
                  {STAGE_ORDER.map((st) => (
                    <button
                      key={st}
                      role="menuitemradio"
                      aria-checked={stage === st}
                      className={stage === st ? "on" : ""}
                      onClick={() => void setStageTo(st)}
                    >
                      <span className={`status-dot stage-${st}`} />
                      {STAGE_LABEL[st]}
                      {stage === st && <span className="tick">✓</span>}
                    </button>
                  ))}
                  <div className="menu-rule" />
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMenu(false);
                      setFiling((f) => !f);
                    }}
                  >
                    <Icon name="archive" />
                    {filing ? "Cancel archiving" : "Archive…"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/*
        Filing asks for the outcome, and asks in one click rather than a modal.
        The outcome is the only part of this worth capturing: it is what the
        funnel divides by, so an application archived as "rejected" and one
        archived as "ghosted" say completely different things about the search.
      */}
      {filing && (
        /*
         * Closing an application, as a small form rather than a row of verdicts.
         *
         * It was five buttons in a strip under the header, which asked the
         * question and gave nowhere to answer it. The outcome is a tally, and
         * five rejections is a number rather than a lesson; the thing worth
         * keeping is the sentence you can only write in the hour afterwards,
         * and there was no box to write it in.
         *
         * Nothing here is required. An application you want off the board at
         * eleven at night is not a moment for a form, so "just archive" files
         * it with no verdict and no note, and the funnel counts it as filed
         * rather than inventing an ending for it.
         */
        <div className="filing">
          <div className="filing-head">
            <b>Archive {company}</b>
            <button className="linkish" onClick={() => setFiling(false)}>
              Cancel
            </button>
          </div>

          <span className="filing-q">How did it end?</span>
          <div className="filing-outcomes">
            {OUTCOMES.map((o) => (
              <button
                key={o.key}
                className={outcome === o.key ? "outcome on" : "outcome"}
                onClick={() => setOutcome(outcome === o.key ? null : o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>

          <label className="filing-note">
            <span>Anything worth remembering?</span>
            <textarea
              rows={3}
              value={lesson}
              placeholder="What you learned, what you would do differently, what they said. Optional."
              onChange={(e) => setLesson(e.target.value)}
            />
            <em>
              Kept in the folder as <code>outcome.md</code> and added to{" "}
              <code>profile/outcomes.md</code>, which Boulot reads before writing anything.
            </em>
          </label>

          <div className="filing-go">
            <button className="ghost" onClick={() => void archive(null)}>
              Just archive
            </button>
            <button className="primary" disabled={!outcome && !lesson.trim()} onClick={() => void archive(outcome)}>
              Archive
            </button>
          </div>
        </div>
      )}

      <div className={wide ? "bench-body wide" : "bench-body"}>
        <section className={`pane${flash ? " pane-flash" : ""}`}>
          <div className="tabs">
            {/*
              Take the document somewhere else.
              
              These get pasted into an application form, an email or a terminal,
              and the alternative is select-all inside a pane that also handles
              click-to-edit and drag-to-select. Copies the markdown, which is
              what the file actually is; the rendered view is a reading of it.
            */}
            {tab !== "pdf" && (text[tab] ?? "").trim() && (
              <button
                className="widen copy"
                title={copied ? "Copied" : "Copy this document"}
                aria-label="Copy this document"
                onClick={() => {
                  const md = text[tab] ?? "";
                  /*
                   * The modern API, with the old one behind it.
                   *
                   * navigator.clipboard needs a secure context and a focused
                   * document, and rejects silently when it does not have both.
                   * A copy button that sometimes does nothing and never says so
                   * is worse than no copy button, so the deprecated path stays
                   * as the fallback.
                   */
                  void navigator.clipboard?.writeText(md).catch(() => {
                    const box = document.createElement("textarea");
                    box.value = md;
                    box.style.position = "fixed";
                    box.style.opacity = "0";
                    document.body.append(box);
                    box.select();
                    try {
                      document.execCommand("copy");
                    } finally {
                      box.remove();
                    }
                  });
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }}
              >
                <Icon name={copied ? "tick" : "copy"} />
              </button>
            )}
            <button
              className="widen"
              onClick={toggleWide}
              title={wide ? "Show the conversation" : "Hide the conversation and widen this"}
              aria-label={wide ? "Show the conversation" : "Widen the document"}
            >
              <Icon name={wide ? "collapse" : "expand"} />
            </button>
            <div className="tab-group">
              {[
                /*
                 * What this application is for, which is not always a CV.
                 *
                 * A company with no advert has no CV to tailor and no PDF to
                 * render, so the first group is the message instead. It also
                 * appears on a normal application once outreach.md exists,
                 * because the two later uses — nudging silence, staying warm
                 * after a rejection — happen long after the lead stage is over.
                 */
                ...(hunting ? [{ key: "outreach", label: "Outreach" } as const] : []),
                ...(hunting ? [] : OUTPUTS),
                ...(!hunting && docs.find((d) => d.key === "outreach")?.exists
                  ? [{ key: "outreach", label: "Outreach" } as const]
                  : []),

                // An extra earns a tab by existing. Until then it is a button.
                ...EXTRAS.filter(
                  (e) =>
                    !NO_DOCUMENT.has(e.key) &&
                    (include.has(e.key) || docs.find((d) => d.key === e.key)?.exists),
                ).map((e) => ({ key: e.key, label: e.key === "cover" ? "Cover letter" : "Questions" })),
                // While talking these have their own group after the split.
                // Last, because that is the order the rail writes them in.
                ...(talking ? [] : extra.map((e) => ({ key: e.key, label: e.label }))),
              ].map((t) => {
                if (t.key === "pdf" && !pdfExists) return null;
                const d = docs.find((x) => x.key === t.key);
                return (
                  <button
                    key={t.key}
                    className={tab === t.key ? "on" : ""}
                    onClick={() => {
                      chosen.current = true;
                      setTab(t.key);
                      setDirty(false);
                    }}
                  >
                    {t.label}
                    {t.key !== "pdf" && d && !d.exists && <span className="empty-dot" title="not written yet" />}
                  </button>
                );
              })}
            </div>

            {/*
              Prep and anything after it are their own group.

              The first group is what was sent. These are what happens next, and
              a second round or a take-home is not another draft of the
              application: it is a different stage of the same process, and the
              rule keeps that legible without a label explaining it.
            */}
            {talking && (
              <>
                <span className="tab-split" />
                <div className="tab-group">
                  {[PREP, ...extra].map((t) => (
                    <button
                      key={t.key}
                      className={tab === t.key ? "on" : ""}
                      onClick={() => {
                        chosen.current = true;
                        setTab(t.key);
                        setDirty(false);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                  {naming ? (
                    <input
                      className="tab-new"
                      autoFocus
                      placeholder="Round 2, take-home…"
                      /*
                       * Clicking away creates it, the same as pressing Enter.
                       *
                       * Discarding on blur throws away typing that took effort
                       * on the theory that leaving the field means changing your
                       * mind. It usually means you thought you were finished.
                       * Escape is the way to mean no, and it still is.
                       */
                      onBlur={(e) => void addTab(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.currentTarget.value = "";
                          setNaming(false);
                        }
                        if (e.key === "Enter") void addTab(e.currentTarget.value);
                      }}
                    />
                  ) : (
                    <button className="tab-add" title="Add a tab for this round" onClick={() => setNaming(true)}>
                      +
                    </button>
                  )}
                </div>
              </>
            )}

            {/*
              The same +, before anyone has replied.

              It used to appear only once the conversation started, so while
              the application was being written the only way to ask for another
              document was two buttons in the rail that could produce exactly
              two documents. Here it produces any of them, and the two everyone
              needs are offered by name so nobody has to guess the spelling.
            */}
            {!talking && !naming && (
              <div className="tab-group tab-more">
                {EXTRAS.filter((e) => !include.has(e.key) && !done(e.key)).map((e) => (
                  <button
                    key={e.key}
                    className="tab-add named"
                    disabled={Boolean(running)}
                    onClick={() => setInclude((prev) => new Set(prev).add(e.key))}
                  >
                    + {e.key === "cover" ? "Cover letter" : "Questions"}
                  </button>
                ))}
                <button
                  className="tab-add"
                  title="Another document for this application"
                  disabled={Boolean(running)}
                  onClick={() => setNaming(true)}
                >
                  +
                </button>
              </div>
            )}
            {!talking && naming && (
              <div className="tab-group tab-more">
                <input
                  className="tab-new"
                  autoFocus
                  placeholder="Diversity statement, portfolio note…"
                  onBlur={(e) => void addTab(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.currentTarget.value = "";
                      setNaming(false);
                    }
                    if (e.key === "Enter") void addTab(e.currentTarget.value);
                  }}
                />
              </div>
            )}

            <span className="tab-split" />

            <div className="tab-group tab-source">
              {SOURCES.map((t) => {
                const d = docs.find((x) => x.key === t.key);
                return (
                  <button
                    key={t.key}
                    className={tab === t.key ? "on" : ""}
                    onClick={() => {
                      chosen.current = true;
                      setTab(t.key);
                      setDirty(false);
                    }}
                  >
                    {t.label}
                    {d && !d.exists && <span className="empty-dot" title="not written yet" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/*
            "Answer these" used to sit here. It was left behind when the build
            list gained checkboxes, so there were two ways to ask for the same
            thing and only one of them respected the order. Pressing it with no
            CV written answered the questions from the master record, which is
            the failure it was supposed to prevent.
          */}
          {tab === "pdf" ? (
            <iframe className="pdf" key={pdfKey} title="CV" src={`/api/${who}/job/${slug}/file/${encodeURIComponent(pdfFile ?? "cv.pdf")}?v=${pdfKey}`} />
          ) : text[tab] === undefined ? (
            <p className="hint">Loading…</p>
          ) : tab === "prep" || extra.some((e) => e.key === tab) ? (
            <PrepDoc
              text={text[tab] ?? ""}
              onChange={(next) => {
                setText((t) => ({ ...t, [tab]: next }));
                setDirty(true);
              }}
              onAsk={(passage) => {
                setAsk(`About this bit:\n\n> ${passage.replace(/\n+/g, " ")}\n\n`);
                composer.current?.focus();
              }}
            />
          ) : READ_ONLY.has(tab) ? (
            /*
             * Reference, not a draft.
             *
             * The job description and the research were shown as raw markdown in
             * a monospace box, frontmatter and all, so the most useful reading
             * on the screen was the least readable thing on it. These are the
             * two documents nobody edits, so they render.
             */
            <div className="reading">
              <Markdown text={stripFrontmatter(text[tab] ?? "")} />
            </div>
          ) : (
            <textarea
              className="editor"
              value={text[tab]}
              spellCheck={false}
              placeholder={
                tab === "questions"
                  ? "Paste the application questions here and press play, or write them out:\n\n1. Why do you want to work here?"
                  : hunting
                    ? "Nothing sent yet. Research them, then draft a message — or write your own here."
                    : "Nothing here yet. Press play and Boulot will write it, or start typing."
              }
              onChange={(e) => {
                setText((t) => ({ ...t, [tab]: e.target.value }));
                setDirty(true);
              }}
            />
          )}

          {fit && !fit.fits && fit.trimTarget && (
            <p className="fitline">
              Cut about <strong>{fit.trimTarget.charactersToCut}</strong> characters from{" "}
              <strong>{fit.trimTarget.section}</strong>. What spills off the end is usually not what to cut.
            </p>
          )}
        </section>

        <section className="pane side">
          {talking ? (
            <div className="checklist">
              {/*
                The date is the headline, because it is the only fact on this
                screen that has a deadline attached. Editable in place: it
                arrives in a later email than the reply does, usually as a
                calendar invite, so it is never known at the moment the stage
                changes.
              */}
              <div className="checklist-top">
                <h3>
                  {running ? (
                    (running ?? "Working")
                  ) : editingDate ? (
                    <span className="when-edit">
                      Preparing for interview on{" "}
                      <input
                        type="date"
                        autoFocus
                        defaultValue={interviewDate ?? ""}
                        onBlur={(e) => void saveInterviewDate(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveInterviewDate(e.currentTarget.value);
                          if (e.key === "Escape") setEditingDate(false);
                        }}
                      />
                    </span>
                  ) : interviewDate ? (
                    <>
                      Preparing for interview on{" "}
                      <button className="when" onClick={() => setEditingDate(true)}>
                        {longDate(interviewDate)}
                      </button>
                    </>
                  ) : (
                    <>
                      Preparing —{" "}
                      <button className="when when-empty" onClick={() => setEditingDate(true)}>
                        add the date
                      </button>
                    </>
                  )}
                </h3>
                {running && (
                  <span className="play busy">
                    <span className="pip" />
                  </span>
                )}
              </div>
              <p className="prep-lede">
                The job description and the research are on the left. Anything you ask goes into{" "}
                <b>{extra.find((e) => e.key === tab)?.label ?? "Prep"}</b>, the tab you have open,
                where you can edit it and write your own notes beside it.
              </p>
              {/*
                Only what the document does not already cover.
                
                The first prep run writes most of these sections, and offering
                eight buttons over a document that already answers six of them
                is a wall of work that has been done. Each action names the
                heading it produces; if that heading is in prep.md, the button
                has nothing to add.
              */}
              {(() => {
                const has = (text.prep ?? "").toLowerCase();
                const left = PREP_ACTIONS.filter((a) => !a.covers.some((h) => has.includes(h)));
                if (!left.length) return null;
                return (
                  <div className="prep-actions">
                    {left.map((a) => (
                      <button
                        key={a.label}
                        title={a.hint}
                        disabled={Boolean(running)}
                        onClick={() => askPrep(a.ask)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : hunting ? (
            <div className="checklist">
              <div className="checklist-top">
                <h3>{running ?? (hasResearch ? "Reach them directly" : "Nobody is hiring here yet")}</h3>
              </div>
              <p className="rail-note">
                {hasResearch
                  ? "No advert means no queue. Write to a person about the problem they have, not the job they have not posted."
                  : "Find out what they are actually building first. A cold message without it reads as a mail merge, and it burns the company for good."}
              </p>
              <div className="prep-actions">
                <button
                  disabled={Boolean(running)}
                  onClick={() =>
                    send(
                      `Research the company behind active/${slug} and write active/${slug}/research.md. ` +
                        `What are they building, what is technically hard about it, who founded it, what ` +
                        `have they raised and when. Say plainly what you could not verify.`,
                      "Researching them",
                      "tweak",
                      modelFor(),
                    )
                  }
                >
                  {hasResearch ? "Research again" : "Research them"}
                </button>
                <button
                  className="primary"
                  disabled={Boolean(running) || !hasResearch}
                  title={hasResearch ? "" : "Research them first"}
                  onClick={() =>
                    send(
                      `Use the boulot:outreach skill for active/${slug}. Read research.md and cv-master.md ` +
                        `first. There is no job description: this company has not advertised. Append a ` +
                        `dated entry to active/${slug}/outreach.md.`,
                      "Writing to them",
                      "tweak",
                      modelFor(),
                    )
                  }
                >
                  Draft the message
                </button>
              </div>
              {cost > 0 && <p className="cost">£{(cost * 0.79).toFixed(2)} this session</p>}
            </div>
          ) : (
          <div className="checklist">
            <div className="checklist-top">
              <h3>
                {runKind === "tweak"
                  ? (running ?? "Working")
                  : allDone
                    ? "Ready to send"
                    : "Build this application"}
              </h3>
              <button
                className={running ? "play busy" : "play"}
                onClick={() => void runAll()}
                disabled={Boolean(running) || allDone}
                title={running ? running : allDone ? "Everything is written" : "Write the whole application"}
              >
                {running ? <span className="pip" /> : allDone ? "✓" : "▶"}
              </button>
            </div>
            <ol>
              {railPlan.map((s) => {
                const isDone = done(s.key);
                const isLive = runKind === "build" && Boolean(running) && !isDone;
                // The three fixed steps are what an application is; the rest
                // you asked for, so only the rest can be taken back off.
                const optional = !STEPS.some((f) => f.key === s.key);
                return (
                  <li key={s.key} className={isDone ? "step-done" : isLive ? "step-live" : ""}>
                    <span className="box">{isDone ? "✓" : isLive ? <span className="dot" /> : ""}</span>
                    <span>{isLive ? s.verb : s.label}</span>
                    {optional && !running && (
                      <button
                        className="step-drop"
                        title="Do not write this"
                        onClick={() =>
                          setInclude((prev) => {
                            const next = new Set(prev);
                            next.delete(s.key);
                            return next;
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>

            {cost > 0 && <p className="cost">£{(cost * 0.79).toFixed(2)} this session</p>}

            {/*
              What you sent, and the one thing left to do about it.

              An applied application keeps the build view because the documents
              are still the point, but the panel said nothing about the fact
              that it had gone. This says when, and asks for the only piece of
              information the app cannot get for itself: whether anyone
              replied. A rejection is as useful as an interview here, because
              the funnel is built from both and a board of applications that
              are all still "applied" a month later teaches nothing.
            */}
            {stage === "applied" && (
              <p className="applied-note">
                {appliedDate ? <>You applied on <b>{longDate(appliedDate)}</b>.</> : <>You marked this as applied.</>}{" "}
                Move it to Interviewing when they reply, or archive it when it ends. Both are how
                Boulot learns what actually works for you.
              </p>
            )}
          </div>
          )}

          <div className="log">
            {/*
              Where the work has got to, above the list of what it touched.

              A build reads the job description three times because three
              reviewers each read it, which is correct and reads as a stuck
              loop. The rail says it once.

              Only for a build. This rail names the stages of writing a CV —
              mapping the job description, three reviewers, rendering the page —
              and none of that is happening once the application is out. Adopting
              a prep run put it on the interview screen, where it announced work
              nobody had asked for and that was not being done, next to a
              conversation about what to say on a call.
            */}
            {activity.length > 0 && runKind !== "tweak" && !talking && (
              <BuildProgress labels={activity} running={Boolean(running)} />
            )}
            {/*
              The raw call list used to sit here. It was nine lines saying what
              the six-line rail above says better, and the only thing it added
              was the impression of repetition: "Rendering the PDF" twice looks
              like a stuck loop and is actually a render, a fix, and a re-render.
            */}
            {turns.map((t, i) =>
              t.who === "you" ? (
                <Asked key={i} text={t.text} />
              ) : (
                <div className="answer" key={i}>
                  <Markdown text={t.text} />
                </div>
              ),
            )}
            {/*
              What came out, from the fit sidecar rather than the agent's
              summary. The renderer measured these; the prose only reports them,
              and a number that is measured should not be read second-hand.
            */}
            {!running && fit && (
              <div className={`result ${fit.fits && !fit.voice?.dashes ? "result-ok" : "result-warn"}`}>
                <b>
                  {fit.fits ? `Fits, ${fit.pages} pages` : `${fit.pages} pages, ${fit.overflowMm}mm over`}
                </b>
                <ul>
                  {!fit.fits && fit.trimTarget && (
                    <li>Cut about {fit.trimTarget.charactersToCut} characters from {fit.trimTarget.section}</li>
                  )}
                  {Boolean(fit.voice?.dashes) && <li>{fit.voice!.dashes} em-dashes to replace</li>}
                  {Boolean(fit.voice?.words?.length) && <li>Vocabulary: {fit.voice!.words.join(", ")}</li>}
                  {Boolean(fit.voice && fit.voice.summaryWords > 60) && (
                    <li>Summary is {fit.voice!.summaryWords} words, target 40 to 60</li>
                  )}
                  {fit.fits && !fit.voice?.dashes && !fit.voice?.words?.length &&
                    !(fit.voice && fit.voice.summaryWords > 60) && <li>No warnings.</li>}
                </ul>
              </div>
            )}

            {connection === "lost" && (
              <p className="offline">
                Lost the connection to Boulot. Reconnecting…
              </p>
            )}
            {/*
              The live line sits last, under the conversation, because that is
              where you are already looking when you are waiting. The label is
              the most recent thing it actually did rather than the name of the
              run, so it changes while you watch it.
            */}
            {Boolean(running) && connection === "open" && (
              <Thinking label={activity[activity.length - 1] ?? running ?? "Working"} since={since} />
            )}
            {!running && !activity.length && !turns.length && (
              <p className="hint">
                {talking
                  ? "Ask what they are likely to push on, how to answer something, or what to ask them. Anything worth keeping goes into Prep."
                  : hunting
                    ? "No advert, so nothing to apply to yet. Find out what they are building, then write to a person about it. If a role appears, paste it into the JD tab and this becomes a normal application."
                    : "Press play and Boulot writes the whole application, updating the documents on the left as it goes. Edit anything yourself, or ask for a change below."}
              </p>
            )}
          </div>

          <div className="composer">
            {/*
              Who you are asking, above the box you ask in.

              Two, not five. A list of models is a decision you have to be
              qualified to make; "quick" and "deep" is a decision about what you
              are doing, which you already know.
            */}
            <div className="agent-pick">
              {AGENTS.map((a) => (
                <button
                  key={a.key}
                  className={agent === a.key ? "on" : ""}
                  title={a.hint}
                  onClick={() => pickAgent(a.key)}
                >
                  {a.label}
                </button>
              ))}
              <span className="agent-hint">{AGENTS.find((a) => a.key === agent)?.hint}</span>
            </div>
            {attached.length > 0 && (
              <div className="attached">
                {attached.map((a) => (
                  <span key={a.id} className="chip-file">
                    <button
                      className="chip-open"
                      title={`${a.text.length.toLocaleString()} characters. Click to read it.`}
                      onClick={() => setOpenAttachment(openAttachment === a.id ? null : a.id)}
                    >
                      <Icon name="doc" />
                      {a.name}
                      <em>{Math.max(1, Math.round(a.text.length / 100) / 10)}k</em>
                    </button>
                    <button
                      className="chip-x"
                      title="Remove"
                      onClick={() => {
                        setAttached((prev) => prev.filter((x) => x.id !== a.id));
                        if (openAttachment === a.id) setOpenAttachment(null);
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {openAttachment != null && (
              <pre className="attached-peek">
                {attached.find((a) => a.id === openAttachment)?.text}
              </pre>
            )}
            <textarea
              ref={composer}
              rows={2}
              value={ask}
              onPaste={(e) => {
                /*
                 * A paste this size is a document, not a sentence.
                 *
                 * Below the threshold it behaves like any other paste, because
                 * intercepting a pasted line would be infuriating. Above it,
                 * the text is held whole and the box stays usable.
                 */
                const text = e.clipboardData.getData("text");
                if (text.length < 320) return;
                e.preventDefault();
                /*
                 * Named by when, not by what it starts with.
                 *
                 * The first line looked like a better label until a real email
                 * arrived and the chip said "Hi Elliot,". A greeting, a heading
                 * or a stray bullet are all equally likely to be first, and a
                 * label that is sometimes meaningful and sometimes noise is
                 * worse than one that is always the same. The timestamp always
                 * distinguishes two pastes; the size says how much there is.
                 */
                const now = new Date();
                const pad = (n: number) => String(n).padStart(2, "0");
                const stamp =
                  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
                  `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
                setAttached((prev) => [
                  ...prev,
                  { id: Date.now() + prev.length, name: `pasted_text_${stamp}.txt`, text },
                ]);
              }}
              placeholder={talking ? "Ask about the interview…" : "Tweak something…"}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) tweak();
              }}
            />
            <button onClick={() => void tweak()} disabled={Boolean(running) || !ask.trim()}>
              Send
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
