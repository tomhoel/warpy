/**
 * Hacker News API client.
 *
 * Official API: https://github.com/HackerNews/API
 * Search API (Algolia): https://hn.algolia.com/api
 */

const HN_BASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HNItem {
  id: number;
  type?: "job" | "story" | "comment" | "poll" | "pollopt";
  by?: string;
  time?: number;
  text?: string;
  url?: string;
  title?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  parent?: number;
  parts?: number[];
  poll?: number;
  dead?: boolean;
  deleted?: boolean;
}

export interface HNUser {
  id: string;
  created: number;
  karma: number;
  about?: string;
  submitted?: number[];
}

export interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string;
  author: string;
  points?: number;
  num_comments?: number;
  created_at: string;
  story_text?: string;
  comment_text?: string;
  story_id?: number;
  parent_id?: number;
  _tags?: string[];
}

export interface AlgoliaSearchResult {
  hits: AlgoliaHit[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data as T;
}

// ---------------------------------------------------------------------------
// Official HN API
// ---------------------------------------------------------------------------

export async function getItem(id: number): Promise<HNItem | null> {
  return fetchJson<HNItem>(`${HN_BASE}/item/${id}.json`);
}

export async function getUser(username: string): Promise<HNUser | null> {
  return fetchJson<HNUser>(`${HN_BASE}/user/${username}.json`);
}

export async function getStoryIds(
  kind:
    | "topstories"
    | "newstories"
    | "beststories"
    | "askstories"
    | "showstories"
    | "jobstories",
): Promise<number[]> {
  const ids = await fetchJson<number[]>(`${HN_BASE}/${kind}.json`);
  return ids ?? [];
}

/**
 * Fetch a page of stories with full item details.
 */
export async function getStories(
  kind:
    | "topstories"
    | "newstories"
    | "beststories"
    | "askstories"
    | "showstories"
    | "jobstories",
  limit: number,
  offset: number,
): Promise<{ items: HNItem[]; total: number }> {
  const allIds = await getStoryIds(kind);
  const pageIds = allIds.slice(offset, offset + limit);
  const items = await Promise.all(pageIds.map((id) => getItem(id)));
  return {
    items: items.filter((i): i is HNItem => i !== null),
    total: allIds.length,
  };
}

/**
 * Recursively fetch comment tree for an item, up to a given depth.
 */
export async function getCommentTree(
  itemId: number,
  maxDepth: number,
  currentDepth = 0,
): Promise<Record<string, unknown> | null> {
  if (currentDepth > maxDepth) return null;

  const item = await getItem(itemId);
  if (!item) return null;

  const children: Record<string, unknown>[] = [];
  if (item.kids && currentDepth < maxDepth) {
    const childResults = await Promise.all(
      item.kids.map((kid) => getCommentTree(kid, maxDepth, currentDepth + 1)),
    );
    for (const child of childResults) {
      if (child) children.push(child);
    }
  }

  return {
    id: item.id,
    by: item.by ?? "[deleted]",
    text: item.text ?? "",
    time: item.time,
    children,
  };
}

// ---------------------------------------------------------------------------
// Algolia Search API
// ---------------------------------------------------------------------------

export async function searchHN(
  query: string,
  opts: {
    tags?: string; // e.g. "story", "comment", "ask_hn", "show_hn", "front_page"
    page?: number;
    hitsPerPage?: number;
    numericFilters?: string; // e.g. "created_at_i>1609459200"
  } = {},
): Promise<AlgoliaSearchResult | null> {
  const params = new URLSearchParams({ query });
  if (opts.tags) params.set("tags", opts.tags);
  if (opts.page !== undefined) params.set("page", String(opts.page));
  if (opts.hitsPerPage !== undefined)
    params.set("hitsPerPage", String(opts.hitsPerPage));
  if (opts.numericFilters) params.set("numericFilters", opts.numericFilters);

  return fetchJson<AlgoliaSearchResult>(
    `${ALGOLIA_BASE}/search?${params.toString()}`,
  );
}
