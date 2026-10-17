export type MemberSort = "recent" | "most" | "name" | "notes";
export type MemberFilter = "all" | "active" | "notes" | "recent";

export const MEMBER_SORTS: { value: MemberSort; label: string }[] = [
  { value: "recent", label: "Most recent action" },
  { value: "most", label: "Most actions" },
  { value: "notes", label: "Most notes" },
  { value: "name", label: "Name" },
];

export const MEMBER_FILTERS: { value: MemberFilter; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Everyone with a record" },
  { value: "active", label: "Restricted now", hint: "A timeout or ban still in force" },
  { value: "notes", label: "Has notes", hint: "At least one staff note" },
  { value: "recent", label: "Last 7 days", hint: "Acted on in the past week" },
];

export const MEMBER_PAGE_SIZE = 25;

export interface MemberListQuery {
  q: string;
  sort: MemberSort;
  filter: MemberFilter;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Anything unrecognised falls back to the defaults, so a hand-edited URL never errors. */
export function parseMemberQuery(raw: RawParams): MemberListQuery {
  const sortValue = first(raw.sort);
  const sort = MEMBER_SORTS.find((entry) => entry.value === sortValue)?.value ?? "recent";
  const filterValue = first(raw.filter);
  const filter = MEMBER_FILTERS.find((entry) => entry.value === filterValue)?.value ?? "all";
  const pageNumber = Number.parseInt(first(raw.page), 10);
  return {
    q: first(raw.q).trim().slice(0, 100),
    sort,
    filter,
    page: Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
  };
}

/** Leaves out values that match the defaults so shared links stay short. */
export function memberListHref(guildId: string, query: Partial<MemberListQuery>): string {
  const search = new URLSearchParams();
  if (query.q) search.set("q", query.q);
  if (query.filter && query.filter !== "all") search.set("filter", query.filter);
  if (query.sort && query.sort !== "recent") search.set("sort", query.sort);
  if (query.page && query.page > 1) search.set("page", String(query.page));
  const text = search.toString();
  return `/guilds/${guildId}/mod/members${text ? `?${text}` : ""}`;
}

/**
 * The query string for the toolbar's fields, without empty values or the
 * defaults, so a submitted search reads like a link built by memberListHref.
 */
export function cleanQuery(fields: Iterable<[string, FormDataEntryValue]>): string {
  const search = new URLSearchParams();
  for (const [key, raw] of fields) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value === "" || (key === "sort" && value === "recent") || (key === "filter" && value === "all") || key === "page") continue;
    search.set(key, value);
  }
  return search.toString();
}

export function memberProfileHref(guildId: string, userId: string): string {
  return `/guilds/${guildId}/mod/members/${encodeURIComponent(userId)}`;
}

/** True when the view is narrower than the default, which decides between the two empty states. */
export function isNarrowed(query: Pick<MemberListQuery, "q" | "filter">): boolean {
  return query.q !== "" || query.filter !== "all";
}

/**
 * Column headers sort by one key each. The backend orders everything except
 * name from highest to lowest, so those columns report "descending".
 */
export function ariaSortFor(active: MemberSort, column: MemberSort): "ascending" | "descending" | "none" {
  if (active !== column) return "none";
  return column === "name" ? "ascending" : "descending";
}

/** Highest value in a series, never below 1, so a flat zero line still scales. */
export function sparkMax(values: number[]): number {
  return Math.max(1, ...values);
}

/**
 * Points for an SVG polyline in a width x height box, with a margin so the
 * stroke is not clipped. Fewer than two values draw nothing.
 */
export function sparkPoints(values: number[], width: number, height: number, margin = 2): string {
  if (values.length < 2) return "";
  const max = sparkMax(values);
  const step = (width - margin * 2) / (values.length - 1);
  return values
    .map((value, index) => {
      const x = margin + index * step;
      const y = height - margin - (Math.max(0, value) / max) * (height - margin * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function activityTotal(values: number[] | undefined): number {
  return (values ?? []).reduce((sum, value) => sum + value, 0);
}

