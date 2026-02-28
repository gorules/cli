# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the GoRules CLI (`@gorules/cli`) - a command-line tool for customers to pull decision rule artifacts from the GoRules BRMS platform.

GoRules is a business rules management system where decision logic (decision graphs, decision tables, expressions) is separated from application code. This CLI enables developers to fetch versioned decision packages for local evaluation using the ZEN engine.

## CLI Usage

```bash
# Authentication (uses Personal Access Token)
gorules auth login
gorules auth status
gorules auth logout

# Releases
gorules releases list -p <project>
gorules releases pull <version> -p <project> [-o <output-dir>]
gorules releases pull latest -p <project>

# Branches
gorules branches list -p <project>
gorules branches pull <branch-name> -p <project> [-o <output-dir>]
```

## Development Commands

```bash
pnpm dev              # Run in development (Node's native TS support)
pnpm dev --help       # Show CLI help
pnpm watch            # Run with watch mode
pnpm build            # Build for production (rolldown bundler)
pnpm lint             # Lint
```

## Architecture

```
src/
├── main.ts           # Entry point, defines CLI commands
├── api.ts            # GoRules API client (fetch-based)
├── config.ts         # Config management (~/.gorules/config.json)
├── types.ts          # TypeScript interfaces for API responses
└── commands/
    ├── auth.ts       # auth login|logout|status
    ├── releases.ts   # releases list|pull
    └── branches.ts   # branches list|pull
```

**Key libraries:**

- `citty` - CLI framework (defineCommand, subCommands)
- `@clack/prompts` - Interactive prompts and spinners
- `picocolors` - Terminal colors

**API:** Uses GoRules BRMS REST API with Bearer token auth. Base URL configurable (default: https://api.gorules.io).

**TypeScript:** Uses `import type` for type-only imports (required for Node's `--experimental-strip-types`).
