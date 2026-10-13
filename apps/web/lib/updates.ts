import { prisma } from "@tier0/db";
import { parseRoadmap, type RoadmapItem } from "./roadmap";
import { BUNDLED_ROADMAP } from "./roadmap-bundled";
import { APP_VERSION, compareVersions, parseVersion } from "./version";

/**
 * What the Updates page and the sidebar know about new versions. It asks GitHub for the project's releases and
 * its roadmap file, and nothing else is sent: no install id, no server names, only the version in the User-Agent.
 * The owner can switch it off, in which case this makes no network request at all.
 */

const REPO = "Luxrrrr/TierZero";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const ROADMAP_URL = `https://raw.githubusercontent.com/${REPO}/main/apps/web/data/roadmap.json`;

const FRESH_MS = 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 6000;
const INSTANCE_ID = 1;

export interface ReleaseInfo {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  url: string;
  prerelease: boolean;
}

export interface UpdateStatus {
  current: string;
  /** The newest release, whether or not it is newer than this install. */
  latest: ReleaseInfo | null;
  updateAvailable: boolean;
  /** Newest first. */
  releases: ReleaseInfo[];
  roadmap: RoadmapItem[];
  /** When GitHub was last asked successfully, or null if it has not been. */
  checkedAt: string | null;
  /** Whether checking is switched on. When it is off nothing here came from the network. */
  enabled: boolean;
  error: string | null;
}

interface Cached {
  releases: ReleaseInfo[];
  roadmap: RoadmapItem[] | null;
  checkedAt: number | null;
  /** Do not ask again before this time. */
  retryAt: number;
  error: string | null;
}

// Pages and routes are bundled apart, so a plain module variable would be one cache per bundle.
const shared = globalThis as typeof globalThis & { __tier0Updates?: { cache: Cached | null; running: Promise<void> | null } };
const state = (shared.__tier0Updates ??= { cache: null, running: null });

export async function updateChecksEnabled(): Promise<boolean> {
  const row = await prisma.instance.findUnique({ where: { id: INSTANCE_ID }, select: { updateChecks: true } }).catch(() => null);
  return row?.updateChecks ?? true;
}

export async function setUpdateChecks(enabled: boolean): Promise<void> {
  await prisma.instance.upsert({ where: { id: INSTANCE_ID }, create: { id: INSTANCE_ID, updateChecks: enabled }, update: { updateChecks: enabled } });
  if (!enabled) state.cache = null;
}

/** Maps GitHub's release list to what the page shows, skipping drafts and anything without a version tag. */
export function readReleases(input: unknown): ReleaseInfo[] {
  if (!Array.isArray(input)) return [];
  const out: ReleaseInfo[] = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    if (r.draft === true || typeof r.tag_name !== "string" || !parseVersion(r.tag_name)) continue;
    out.push({
      tag: r.tag_name,
      name: typeof r.name === "string" && r.name.trim() !== "" ? r.name : r.tag_name,
      publishedAt: typeof r.published_at === "string" ? r.published_at : "",
      body: typeof r.body === "string" ? r.body.slice(0, 20_000) : "",
      url: typeof r.html_url === "string" && r.html_url.startsWith("https://github.com/") ? r.html_url : `https://github.com/${REPO}/releases`,
      prerelease: r.prerelease === true,
    });
  }
  return out.sort((a, b) => compareVersions(b.tag, a.tag));
}

async function getJson(url: string, accept: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept, "user-agent": `TierZero/${APP_VERSION}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.json();
}

async function refresh(): Promise<void> {
  const now = Date.now();
  const previous = state.cache;
  try {
    const releases = readReleases(await getJson(RELEASES_URL, "application/vnd.github+json"));
    // The roadmap is optional. Failing to read it must not hide the releases.
    const roadmap = await getJson(ROADMAP_URL, "application/json").then(parseRoadmap, () => null);
    state.cache = { releases, roadmap: roadmap && roadmap.length > 0 ? roadmap : (previous?.roadmap ?? null), checkedAt: now, retryAt: now + FRESH_MS, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The check failed.";
    // Keep whatever was known and try again later, so a flaky connection does not blank the page.
    state.cache = { releases: previous?.releases ?? [], roadmap: previous?.roadmap ?? null, checkedAt: previous?.checkedAt ?? null, retryAt: now + RETRY_AFTER_FAILURE_MS, error: message };
  }
}

export async function getUpdateStatus(options: { force?: boolean } = {}): Promise<UpdateStatus> {
  const enabled = await updateChecksEnabled();
  if (enabled && (options.force || !state.cache || Date.now() >= state.cache.retryAt)) {
    // Several requests asking at once share one lookup.
    state.running ??= refresh().finally(() => {
      state.running = null;
    });
    await state.running;
  }
  return buildStatus(enabled);
}

function buildStatus(enabled: boolean): UpdateStatus {
  const cache = enabled ? state.cache : null;
  const releases = cache?.releases ?? [];
  const latest = releases.find((r) => !r.prerelease) ?? releases[0] ?? null;
  return {
    current: APP_VERSION,
    latest,
    updateAvailable: latest !== null && compareVersions(latest.tag, APP_VERSION) > 0,
    releases,
    roadmap: cache?.roadmap ?? BUNDLED_ROADMAP,
    checkedAt: cache?.checkedAt ? new Date(cache.checkedAt).toISOString() : null,
    enabled,
    error: cache?.error ?? null,
  };
}

/**
 * The same answer as getUpdateStatus, without ever waiting for the network. Every page draws the sidebar from this,
 * so a slow GitHub must not slow the page. A stale or missing answer starts a refresh in the background and the
 * next page load sees its result.
 */
export async function peekUpdateStatus(): Promise<UpdateStatus> {
  const enabled = await updateChecksEnabled();
  if (enabled && (!state.cache || Date.now() >= state.cache.retryAt)) {
    state.running ??= refresh().finally(() => {
      state.running = null;
    });
    void state.running.catch(() => undefined);
  }
  return buildStatus(enabled);
}
