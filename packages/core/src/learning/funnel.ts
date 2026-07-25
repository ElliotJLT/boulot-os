import type { Application } from "../schema/status.js";
import { daysBetween } from "../pipeline/flags.js";

/**
 * Derive the funnel from application records.
 *
 * The vault already has an `/archive` command that asks the model to write an
 * `outcome.md` and update six sections of a `learning.md` on every archive.
 * Measured: 4 of 26 archived roles for one user, 0 of 11 for the other. Half of
 * the four have `cv_used: null`.
 *
 * That is not a discipline problem, it is a design problem. The bookkeeping
 * falls due immediately after a rejection, which is the worst possible moment
 * to ask someone for structured data entry. So none of it is asked for here.
 * Everything below is computed from `status.md`, which already exists for every
 * application because the pipeline cannot function without it.
 *
 * The rule: never ask a human to record what the system can observe.
 */

export interface FunnelStage {
  label: string;
  count: number;
  /** Share of everything applied. */
  rate: number;
}

export interface Funnel {
  total: number;
  applied: number;
  stages: FunnelStage[];
  /** Median days from applied_date to last_updated on terminal applications. */
  medianDaysToClose: number | null;
  bySource: Array<{ source: string; applied: number; interviewed: number; rate: number }>;
  /** Applications with no outcome recorded and no activity for a long time. */
  presumedGhosted: number;
}

const REACHED_INTERVIEW = new Set(["interviewing", "offer", "closed-won"]);
const REACHED_SCREEN = new Set(["screening", ...REACHED_INTERVIEW]);
const TERMINAL = new Set(["closed-won", "closed-lost"]);

/** True once an application has actually been sent. */
function wasApplied(a: Application): boolean {
  return a.stage !== "lead" && a.stage !== "drafting";
}

/**
 * Furthest point reached.
 *
 * A rejected application still reached whatever stage it reached, so the
 * terminal stage alone under-counts every funnel step. `substage` and
 * `outcome` carry the detail that makes this recoverable.
 */
function reachedInterview(a: Application): boolean {
  if (REACHED_INTERVIEW.has(a.stage)) return true;
  // A closed application that mentions an interview stage in its substage got
  // further than "applied", even though it ended at closed-lost.
  return /interview|onsite|final|task day|whiteboard/i.test(a.substage ?? "");
}

function reachedScreen(a: Application): boolean {
  if (REACHED_SCREEN.has(a.stage)) return true;
  return reachedInterview(a) || /screen|call|phone/i.test(a.substage ?? "");
}

/** Known application channels, matched anywhere in the raw value. */
const SOURCE_PATTERNS: Array<[RegExp, string]> = [
  [/greenhouse/i, "greenhouse"],
  [/lever/i, "lever"],
  [/ashby/i, "ashby"],
  [/workable/i, "workable"],
  [/linkedin/i, "linkedin"],
  [/otta|welcome to the jungle/i, "otta"],
  [/wellfound|angellist/i, "wellfound"],
  [/recruiter|agency|headhunt/i, "recruiter"],
  [/referral|warm|intro/i, "referral"],
  [/startup\.?jobs/i, "startup.jobs"],
  [/sifted/i, "sifted"],
  [/direct|careers page|website/i, "direct"],
];

/**
 * Reduce a freeform `source:` to a comparable channel.
 *
 * The field is written by hand, so it holds everything from "LinkedIn" to a
 * full Greenhouse URL to the literal string "null". An earlier version took the
 * first whitespace-delimited token, which turned every URL into "https:" and
 * counted "null" as a channel. Both are noise that would make the by-source
 * conversion table actively misleading.
 */
export function normaliseSource(raw: string | null): string {
  const value = (raw ?? "").trim();
  if (!value || /^(null|none|n\/a|-)$/i.test(value)) return "unknown";

  for (const [pattern, label] of SOURCE_PATTERNS) {
    if (pattern.test(value)) return label;
  }

  // A URL we don't recognise: use its hostname, not its scheme.
  const host = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(value)?.[1];
  if (host) return host.toLowerCase();

  return value.toLowerCase().slice(0, 24);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : Math.round((((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2));
}

export function buildFunnel(apps: Application[], today: Date = new Date()): Funnel {
  const applied = apps.filter(wasApplied);
  const n = applied.length || 1;

  const screened = applied.filter(reachedScreen);
  const interviewed = applied.filter(reachedInterview);
  const offered = applied.filter((a) => a.stage === "offer" || a.stage === "closed-won");
  const accepted = applied.filter((a) => a.outcome === "offer_accepted");

  const durations: number[] = [];
  for (const a of applied) {
    if (!TERMINAL.has(a.stage) || !a.appliedDate || !a.lastUpdated) continue;
    const from = new Date(a.appliedDate);
    const to = new Date(a.lastUpdated);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) continue;
    const d = daysBetween(from, to);
    if (d >= 0) durations.push(d);
  }

  // Nobody writes "ghosted" in a status file. It is the absence of anything:
  // sent, never progressed, silent for a long time, never formally closed.
  const presumedGhosted = applied.filter((a) => {
    if (TERMINAL.has(a.stage)) return false;
    if (reachedScreen(a)) return false;
    if (!a.lastUpdated) return false;
    const d = new Date(a.lastUpdated);
    return !Number.isNaN(d.getTime()) && daysBetween(d, today) > 45;
  }).length;

  const sources = new Map<string, { applied: number; interviewed: number }>();
  for (const a of applied) {
    const key = normaliseSource(a.source);
    const row = sources.get(key) ?? { applied: 0, interviewed: 0 };
    row.applied += 1;
    if (reachedInterview(a)) row.interviewed += 1;
    sources.set(key, row);
  }

  return {
    total: apps.length,
    applied: applied.length,
    stages: [
      { label: "Applied", count: applied.length, rate: 1 },
      { label: "Screen", count: screened.length, rate: screened.length / n },
      { label: "Interview", count: interviewed.length, rate: interviewed.length / n },
      { label: "Offer", count: offered.length, rate: offered.length / n },
      { label: "Accepted", count: accepted.length, rate: accepted.length / n },
    ],
    medianDaysToClose: median(durations),
    presumedGhosted,
    bySource: [...sources.entries()]
      .map(([source, r]) => ({
        source,
        applied: r.applied,
        interviewed: r.interviewed,
        rate: r.applied ? r.interviewed / r.applied : 0,
      }))
      .sort((a, b) => b.applied - a.applied),
  };
}
