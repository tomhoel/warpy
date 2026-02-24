# hn-mcp-server

An MCP (Model Context Protocol) server that provides access to Hacker News data — stories, comments, users, and search — through a standardized tool interface.

## Tools

| Tool | Description |
|------|-------------|
| `hn_get_item` | Get any HN item (story, comment, job, poll) by ID |
| `hn_get_user` | Get a user profile by username |
| `hn_top_stories` | Current top stories |
| `hn_new_stories` | Newest stories |
| `hn_best_stories` | Highest-voted recent stories |
| `hn_ask_stories` | Ask HN posts |
| `hn_show_stories` | Show HN posts |
| `hn_job_stories` | Job postings |
| `hn_get_comments` | Comment tree for any story/comment |
| `hn_search` | Full-text search via Algolia |

## Installation

```bash
npm install
npm run build
```

## Usage

### As an MCP server (stdio)

```bash
node dist/index.js
```

### Warp MCP configuration

```json
{
  "hn-mcp-server": {
    "command": "node",
    "args": ["/path/to/hn-mcp-server/dist/index.js"]
  }
}
```

Or with npx (after publishing):

```json
{
  "hn-mcp-server": {
    "command": "npx",
    "args": ["-y", "hn-mcp-server"]
  }
}
```

## API Sources

- **Official HN API**: https://github.com/HackerNews/API (stories, comments, users, live data)
- **Algolia Search API**: https://hn.algolia.com/api (full-text search, filtering)

## License

MIT
