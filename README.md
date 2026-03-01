# @gorules/cli

Command-line tool for [GoRules](https://gorules.io) — a business rules management system (BRMS) for decision tables, decision graphs, and expressions.

## Installation

```bash
npm install -g @gorules/cli
```

Or run directly with npx (e.g. mcp start):

```bash
npx @gorules/cli mcp start
```

## MCP Bridge

2
The CLI includes an MCP (Model Context Protocol) bridge that connects AI tools like Claude, Cursor, and Windsurf to the GoRules decision graph editor.

### Quick Start

```bash
gorules mcp start
```

This starts a local server on `localhost:41919` that:

- Exposes an **MCP endpoint** (`/mcp`) for AI tool integration
- Connects to the GoRules editor via **WebSocket**
- Provides **REST endpoints** for evaluating decisions and fetching files

### Options

| Flag         | Description           | Default     |
| ------------ | --------------------- | ----------- |
| `-p, --port` | Server port           | `41919`     |
| `-h, --host` | Server host           | `localhost` |
| `-u, --url`  | GoRules server URL    | —           |
| `--open`     | Open browser on start | `false`     |

### Connecting

1. Run `gorules mcp start`
2. Open the GoRules editor and click **Connect MCP**
3. Enter the connection token displayed in your terminal

### REST Endpoints

The bridge exposes REST endpoints for local development:

**Evaluate a decision graph:**

```bash
curl -X POST http://localhost:41919/evaluate/my-decision \
  -H "Content-Type: application/json" \
  -d '{"context": {"customer": {"tier": "premium"}, "orderTotal": 150}}'
```

**Retrieve a decision file:**

```bash
curl http://localhost:41919/file/my-decision
```

These endpoints can also be used as a loader for [ZenEngine](https://github.com/gorules/zen):

```js
const engine = new ZenEngine({
  loader: async (key) => {
    const res = await fetch(`http://localhost:41919/file/${key}`);
    return res.json();
  },
});
```

### AI Tool Configuration

Add the MCP server to your AI tool's configuration:

**Claude Desktop / Claude Code:**

```json
{
  "mcpServers": {
    "gorules": {
      "command": "gorules",
      "args": ["mcp", "start"]
    }
  }
}
```

## Development

```bash
pnpm install
pnpm dev          # Build and run
pnpm build        # Production build
pnpm lint         # Lint
pnpm format:fix   # Format
```

## License

[MIT](LICENSE)
