/**
 * Job board readers.
 *
 * Half of this vault's applications come from Ashby, Greenhouse or Workable,
 * and all three publish the job description over an unauthenticated JSON API.
 * Fetching the HTML page instead gets you a JavaScript shell and a title, which
 * is how a real attempt ended up asking the user to paste a description that
 * was available as structured data the whole time.
 *
 * Verified live against real postings: Ashby (descriptionPlain, ~5.5k chars)
 * and Greenhouse (content, ~9k chars). Lever and Workable follow the same
 * documented shape but are not verified here, so they degrade to the same
 * honest failure as any other host rather than pretending.
 */

export interface FetchedJob {
  ok: boolean;
  source: string;
  title?: string;
  company?: string;
  location?: string;
  employmentType?: string;
  compensation?: string;
  url?: string;
  description?: string;
  /** Present when the posting was found but is no longer public. */
  unlisted?: boolean;
  error?: string;
}

const strip = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h\d|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function getJson(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Boulot/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** jobs.ashbyhq.com/{org}/{uuid} */
async function ashby(url: URL): Promise<FetchedJob | null> {
  const [org, id] = url.pathname.split("/").filter(Boolean);
  if (!org) return null;

  const data = (await getJson(
    `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`,
  )) as { jobs?: Array<Record<string, unknown>> } | null;
  if (!data?.jobs?.length) return null;

  const jobs = data.jobs;
  const job = (id ? jobs.find((j) => String(j.id) === id) : undefined) ?? undefined;

  if (id && !job) {
    // Distinguish "this posting is gone" from "we could not read the board",
    // because those need different responses from the user.
    return {
      ok: false,
      source: "ashby",
      unlisted: true,
      error:
        `That posting is not in ${org}'s live job board (${jobs.length} roles listed). ` +
        `It may have closed. Live titles include: ${jobs.slice(0, 6).map((j) => j.title).join(", ")}.`,
    };
  }
  if (!job) return null;

  const comp = job.compensation as { compensationTierSummary?: string } | undefined;
  return {
    ok: true,
    source: "ashby",
    title: String(job.title ?? ""),
    company: org,
    location: String(job.location ?? ""),
    employmentType: String(job.employmentType ?? ""),
    ...(comp?.compensationTierSummary ? { compensation: comp.compensationTierSummary } : {}),
    url: String(job.jobUrl ?? url.href),
    description: String(job.descriptionPlain ?? strip(String(job.descriptionHtml ?? ""))),
  };
}

/** boards.greenhouse.io/{org}/jobs/{id} and job-boards.greenhouse.io/{org}/jobs/{id} */
async function greenhouse(url: URL): Promise<FetchedJob | null> {
  const parts = url.pathname.split("/").filter(Boolean);
  const org = parts[0];
  const id = parts[parts.indexOf("jobs") + 1] ?? parts.at(-1);
  if (!org || !id) return null;

  const job = (await getJson(
    `https://boards-api.greenhouse.io/v1/boards/${org}/jobs/${id}`,
  )) as Record<string, unknown> | null;
  if (!job?.title) return null;

  const loc = job.location as { name?: string } | undefined;
  return {
    ok: true,
    source: "greenhouse",
    title: String(job.title),
    company: String(job.company_name ?? org),
    location: String(loc?.name ?? ""),
    url: String(job.absolute_url ?? url.href),
    description: strip(String(job.content ?? "")),
  };
}

/** jobs.lever.co/{org}/{id}. Documented shape; not verified against a live posting. */
async function lever(url: URL): Promise<FetchedJob | null> {
  const [org, id] = url.pathname.split("/").filter(Boolean);
  if (!org || !id) return null;

  const job = (await getJson(`https://api.lever.co/v0/postings/${org}/${id}`)) as Record<
    string,
    unknown
  > | null;
  if (!job?.text) return null;

  const cat = job.categories as { location?: string; commitment?: string } | undefined;
  return {
    ok: true,
    source: "lever",
    title: String(job.text),
    company: org,
    location: String(cat?.location ?? ""),
    employmentType: String(cat?.commitment ?? ""),
    url: String(job.hostedUrl ?? url.href),
    description: strip(String(job.descriptionPlain ?? job.description ?? "")),
  };
}

/** {org}.workable.com/j/{shortcode}. Documented shape; not verified here. */
async function workable(url: URL): Promise<FetchedJob | null> {
  const org = url.hostname.split(".")[0];
  const code = url.pathname.split("/").filter(Boolean).at(-1);
  if (!org || !code) return null;

  const job = (await getJson(`https://${org}.workable.com/api/v1/jobs/${code}`)) as Record<
    string,
    unknown
  > | null;
  if (!job?.title) return null;

  return {
    ok: true,
    source: "workable",
    title: String(job.title),
    company: org,
    location: String(job.location ?? ""),
    url: url.href,
    description: strip(String(job.description ?? "")),
  };
}

export async function fetchJob(rawUrl: string): Promise<FetchedJob> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, source: "none", error: "That is not a URL." };
  }

  const host = url.hostname.toLowerCase();
  const readers: Array<[boolean, () => Promise<FetchedJob | null>]> = [
    [host.includes("ashbyhq.com"), () => ashby(url)],
    [host.includes("greenhouse.io"), () => greenhouse(url)],
    [host.includes("lever.co"), () => lever(url)],
    [host.includes("workable.com"), () => workable(url)],
  ];

  for (const [matches, read] of readers) {
    if (!matches) continue;
    const job = await read();
    if (job) return job;
    break;
  }

  return {
    ok: false,
    source: host,
    error:
      `No structured job data available for ${host}. ` +
      `Ashby, Greenhouse, Lever and Workable publish descriptions as JSON; other boards, ` +
      `including LinkedIn, do not and mostly render the description in JavaScript. ` +
      `Ask the user to paste the description rather than guessing at it.`,
  };
}
