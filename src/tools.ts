import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getItem,
  getUser,
  getStories,
  getCommentTree,
  searchHN,
} from "./api.js";
import type { HNItem, AlgoliaHit } from "./api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTime(unix?: number): string {
  if (!unix) return "unknown";
  return new Date(unix * 1000).toISOString();
}

function formatStory(item: HNItem): string {
  const parts: string[] = [];
  parts.push(`[${item.id}] ${item.title ?? "(no title)"}`);
  if (item.url) parts.push(`  URL: ${item.url}`);
  if (item.score !== undefined) parts.push(`  Score: ${item.score}`);
  if (item.by) parts.push(`  By: ${item.by}`);
  if (item.descendants !== undefined)
    parts.push(`  Comments: ${item.descendants}`);
  parts.push(`  Posted: ${formatTime(item.time)}`);
  return parts.join("\n");
}

function formatAlgoliaHit(hit: AlgoliaHit): string {
  const parts: string[] = [];
  parts.push(`[${hit.objectID}] ${hit.title ?? "(comment)"}`);
  if (hit.url) parts.push(`  URL: ${hit.url}`);
  if (hit.points !== undefined) parts.push(`  Points: ${hit.points}`);
  parts.push(`  Author: ${hit.author}`);
  if (hit.num_comments !== undefined)
    parts.push(`  Comments: ${hit.num_comments}`);
  parts.push(`  Created: ${hit.created_at}`);
  return parts.join("\n");
}

// Reusable pagination schema
const paginationSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Number of items to return (1-50, default 10)"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of items to skip (default 0)"),
};

// Read-only annotations shared by all tools
const readOnlyAnnotations = {
  readOnlyHint: true as const,
  destructiveHint: false as const,
  idempotentHint: true as const,
  openWorldHint: true as const,
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerTools(server: McpServer): void {
  // 1. hn_get_item
  server.registerTool(
    "hn_get_item",
    {
      title: "Get HN Item",
      description:
        "Retrieve a Hacker News item (story, comment, job, poll, or poll option) by its numeric ID. " +
        "Returns all available fields including title, URL, score, author, text, and child comment IDs.",
      inputSchema: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The item's unique numeric ID (e.g. 8863)"),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      const item = await getItem(id);
      if (!item) {
        return {
          content: [
            {
              type: "text",
              text: `Item ${id} not found. IDs are positive integers. Use hn_top_stories to find valid IDs.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(item, null, 2) }],
      };
    },
  );

  // 2. hn_get_user
  server.registerTool(
    "hn_get_user",
    {
      title: "Get HN User",
      description:
        "Retrieve a Hacker News user profile by username. " +
        "Returns karma, account creation date, about text, and recent submission IDs. " +
        "Usernames are case-sensitive.",
      inputSchema: {
        username: z
          .string()
          .min(1)
          .describe("Case-sensitive HN username (e.g. 'pg', 'dang')"),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ username }) => {
      const user = await getUser(username);
      if (!user) {
        return {
          content: [
            {
              type: "text",
              text: `User "${username}" not found. Usernames are case-sensitive. Try searching with hn_search instead.`,
            },
          ],
          isError: true,
        };
      }
      const result = {
        id: user.id,
        karma: user.karma,
        created: formatTime(user.created),
        about: user.about ?? null,
        recentSubmissions: (user.submitted ?? []).slice(0, 20),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 3-8. Story listing tools (all share the same structure)
  const storyTools: Array<{
    name: string;
    title: string;
    description: string;
    kind:
      | "topstories"
      | "newstories"
      | "beststories"
      | "askstories"
      | "showstories"
      | "jobstories";
  }> = [
    {
      name: "hn_top_stories",
      title: "Top Stories",
      description:
        "Get the current top stories on Hacker News, ranked by the HN ranking algorithm. " +
        "Returns story details including title, URL, score, author, and comment count.",
      kind: "topstories",
    },
    {
      name: "hn_new_stories",
      title: "New Stories",
      description:
        "Get the newest stories posted to Hacker News, ordered by submission time (most recent first). " +
        "Returns story details including title, URL, score, author, and comment count.",
      kind: "newstories",
    },
    {
      name: "hn_best_stories",
      title: "Best Stories",
      description:
        "Get the best stories on Hacker News (highest-voted recent stories). " +
        "Returns story details including title, URL, score, author, and comment count.",
      kind: "beststories",
    },
    {
      name: "hn_ask_stories",
      title: "Ask HN Stories",
      description:
        "Get the latest Ask HN posts — questions submitted by users to the HN community. " +
        "Returns story details including title, text, score, author, and comment count.",
      kind: "askstories",
    },
    {
      name: "hn_show_stories",
      title: "Show HN Stories",
      description:
        "Get the latest Show HN posts — projects and products shared by users with the HN community. " +
        "Returns story details including title, URL, score, author, and comment count.",
      kind: "showstories",
    },
    {
      name: "hn_job_stories",
      title: "Job Stories",
      description:
        "Get the latest job postings on Hacker News. " +
        "Returns job details including title, URL/text, and posting time.",
      kind: "jobstories",
    },
  ];

  for (const tool of storyTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: paginationSchema,
        annotations: readOnlyAnnotations,
      },
      async ({ limit, offset }) => {
        const safeLimit = clamp(limit, 1, 50);
        const safeOffset = Math.max(0, offset);
        const { items, total } = await getStories(
          tool.kind,
          safeLimit,
          safeOffset,
        );

        if (items.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No stories found at offset ${safeOffset}. Total available: ${total}.`,
              },
            ],
          };
        }

        const header = `${tool.title} (${safeOffset + 1}-${safeOffset + items.length} of ${total})\n${"=".repeat(50)}`;
        const body = items.map(formatStory).join("\n\n");
        return {
          content: [{ type: "text", text: `${header}\n\n${body}` }],
        };
      },
    );
  }

  // 9. hn_get_comments
  server.registerTool(
    "hn_get_comments",
    {
      title: "Get Comments",
      description:
        "Retrieve the comment tree for a Hacker News story or comment. " +
        "Returns nested comments with author, text, and timestamps. " +
        "Use the depth parameter to control how deep to traverse (default 2, max 5). " +
        "Higher depths fetch more data and take longer.",
      inputSchema: {
        id: z
          .number()
          .int()
          .positive()
          .describe(
            "The ID of the story or comment to get comments for (e.g. 8863)",
          ),
        depth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .default(2)
          .describe("Max depth of comment tree to fetch (1-5, default 2)"),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ id, depth }) => {
      const safeDepth = clamp(depth, 1, 5);
      const tree = await getCommentTree(id, safeDepth);
      if (!tree) {
        return {
          content: [
            {
              type: "text",
              text: `Item ${id} not found. Use hn_get_item first to verify the ID exists.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(tree, null, 2) }],
      };
    },
  );

  // 10. hn_search
  server.registerTool(
    "hn_search",
    {
      title: "Search HN",
      description:
        "Search Hacker News stories and comments using the Algolia search API. " +
        "Supports filtering by type (story, comment, ask_hn, show_hn) and pagination. " +
        "Results are ranked by relevance. Use numericFilters for date-based queries " +
        "(e.g. 'created_at_i>1609459200' for posts after 2021-01-01).",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Search query string (e.g. 'rust programming')"),
        tags: z
          .string()
          .optional()
          .describe(
            "Filter by type: 'story', 'comment', 'ask_hn', 'show_hn', 'front_page'. " +
              "Combine with commas for AND, parentheses with commas for OR: e.g. 'story' or '(story,comment)'",
          ),
        page: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Page number for pagination (0-indexed, default 0)"),
        hitsPerPage: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Results per page (1-50, default 10)"),
        numericFilters: z
          .string()
          .optional()
          .describe(
            "Numeric filter expression, e.g. 'created_at_i>1609459200,points>100'",
          ),
      },
      annotations: readOnlyAnnotations,
    },
    async ({ query, tags, page, hitsPerPage, numericFilters }) => {
      const result = await searchHN(query, {
        tags,
        page,
        hitsPerPage: clamp(hitsPerPage, 1, 50),
        numericFilters,
      });

      if (!result) {
        return {
          content: [
            {
              type: "text",
              text: "Search request failed. Check your query and try again.",
            },
          ],
          isError: true,
        };
      }

      if (result.hits.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No results found for "${query}". Try broader search terms or different filters.`,
            },
          ],
        };
      }

      const header = `Search results for "${query}" (page ${result.page + 1} of ${result.nbPages}, ${result.nbHits} total hits)\n${"=".repeat(50)}`;
      const body = result.hits.map(formatAlgoliaHit).join("\n\n");
      return {
        content: [{ type: "text", text: `${header}\n\n${body}` }],
      };
    },
  );
}
