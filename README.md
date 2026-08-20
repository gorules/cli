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

## Pulling rules into a pipeline

`gorules pull` resolves a target in BRMS and downloads the matching rules artifact. It is the
building block for shipping rules from BRMS into your own infrastructure: a CI job pulls the
artifact and uploads it wherever your runtime reads it from.

```bash
export GORULES_URL=https://acme.us1.gorules.io
export GORULES_TOKEN=...            # project access token, read scope is enough

gorules pull --project pricing --target env:production --out ./dist
aws s3 cp ./dist/ s3://my-bucket/rules/live/ --recursive
```

### Targets

| Target              | Resolves to                                       |
| ------------------- | ------------------------------------------------- |
| `main` (default)    | latest commit on the default branch               |
| `branch:<branchId>` | latest commit on that branch                      |
| `commit:<commitId>` | that exact commit, pinned                         |
| `release:<version>` | that release, by semantic version or id           |
| `env:<key>`         | whichever release is deployed to that environment |

### Options

| Flag            | Env               | Description                                                                                       |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `-p, --project` | `GORULES_PROJECT` | Project key or id                                                                                 |
| `-t, --target`  | `GORULES_TARGET`  | Target to resolve (default `main`)                                                                |
| `-o, --out`     |                   | Output directory (default `.`)                                                                    |
| `--unpack`      |                   | Extract the archive instead of writing it                                                         |
| `--delete`      |                   | With `--unpack`: delete files not in the artifact so the directory mirrors the target exactly     |
| `--name`        |                   | Output file name (zip) or sub-directory name (dir); defaults to the project key with no extension |
| `--current`     |                   | Release or commit id you already hold; exits `3` when unchanged                                   |
| `-u, --url`     | `GORULES_URL`     | BRMS URL                                                                                          |
| `--token`       | `GORULES_TOKEN`   | Access token                                                                                      |
| `--json`        |                   | Print the result as JSON on stdout                                                                |

### Naming the output

The default writes `<project-key>` with **no** `.zip` suffix, because the agent's S3, GCS and Azure
Blob providers use the object name verbatim as the project key: upload `pricing.zip` and the agent
serves a project literally called `pricing.zip`.

The agent's local `zip` provider is the opposite -- it reads `<root>/<project>.zip` and strips the
suffix itself -- so that destination needs it back:

```bash
gorules pull --project pricing --name pricing.zip --out ./rules
```

With `--unpack`, `--name` is the sub-directory to extract into (default: the project key, which is
the layout the agent's `filesystem` provider expects). Pass `--name .` to extract straight into
`--out`, which is what you want when baking rules into a container image.

Extraction behaves like `aws s3 sync`: byte-identical files are left untouched, changed files are
written atomically (temp file + rename, so a concurrent reader never sees a partial write), and
files the artifact does not carry are preserved. Add `--delete` for `s3 sync --delete` semantics:
the directory mirrors the target exactly, so rules deleted in BRMS are deleted on disk too. As a
guard against wiping a directory it does not own, `--delete` refuses a non-empty destination that
has no `.config/project.json` from a previous pull, and deletions only run after every new file has
been written.

### Examples

Object storage that the agent watches -- one archive per project, no extension:

```bash
gorules pull --project pricing --target env:production --out ./dist
aws s3 cp ./dist/ s3://my-bucket/rules/live/ --recursive
```

A volume the agent reads with its `filesystem` provider -- unpacked, one directory per project:

```bash
gorules pull --project pricing --target env:production --out /srv/rules --unpack
# /srv/rules/pricing/...
```

Baked into a container image, pinned to an exact release so the build is reproducible:

```bash
gorules pull --project pricing --target release:1.4.2 --out ./rules --unpack --name .
# ./rules/*.json + ./rules/.config/project.json, ready for COPY
```

Scheduled job that does nothing when production has not moved:

```bash
gorules pull --project pricing --target env:production --current "$LAST_RELEASE_ID" --out ./dist
case $? in
  0) aws s3 cp ./dist/ s3://my-bucket/rules/live/ --recursive ;;
  3) echo "unchanged" ;;
  *) exit 1 ;;
esac
```

### Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| `0`  | Artifact downloaded                                  |
| `1`  | Error                                                |
| `2`  | Usage error (missing or invalid arguments)           |
| `3`  | Nothing to do (`--current` matched what is deployed) |
| `4`  | No release is deployed to the target                 |

Pin the version in a pipeline rather than tracking `latest`:

```bash
npx @gorules/cli@0.3.2 pull --project pricing --target env:production # x-release-please-version
```

## GitHub Actions

Composite actions live under `actions/`, in this repository, so the tag you pin is the CLI version
you get.

```yaml
on:
  workflow_dispatch:
    inputs:
      payload:
        description: Set by BRMS when a webhook triggers the run; the action picks it up automatically
        required: false
        type: string

jobs:
  rules:
    runs-on: ubuntu-latest
    steps:
      - uses: gorules/cli/actions/pull@cli-v0.3.2 # x-release-please-version
        id: rules
        with:
          url: https://acme.us1.gorules.io
          token: ${{ secrets.GORULES_TOKEN }}
          # project and target normally arrive in the BRMS payload; set them
          # only for runs that have none (manual without payload, schedules)
          out: ./dist

      - name: Deploy
        env:
          PROJECT: ${{ steps.rules.outputs.project }}
        run: aws s3 cp "./dist/$PROJECT" "s3://my-bucket/rules/$PROJECT"
```

| Input         | Required | Description                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `url`         | yes      | BRMS URL                                                                         |
| `token`       | yes      | Access token; pass a secret                                                      |
| `project`     | yes\*    | Project key or id; optional when `payload` is set                                |
| `target`      |          | Target to resolve (default `main`)                                               |
| `out`         |          | Output directory (default `.`)                                                   |
| `name`        |          | Output file or sub-directory name                                                |
| `unpack`      |          | `true` to extract the archive                                                    |
| `delete`      |          | With `unpack`, mirror the target exactly (delete stale files)                    |
| `current`     |          | Release or commit id already held                                                |
| `payload`     |          | BRMS event payload; auto-detected from `workflow_dispatch`, set only to override |
| `cli-version` |          | Version of `@gorules/cli` to run                                                 |

| Output                           | Description                                                     |
| -------------------------------- | --------------------------------------------------------------- |
| `project` / `target`             | What was pulled, payload-aware                                  |
| `changed`                        | `false` when `current` still matched, so nothing was downloaded |
| `release` / `version` / `commit` | What the target resolved to                                     |
| `sha256`                         | Checksum of the downloaded artifact                             |
| `files`                          | JSON array of paths written                                     |

The token is passed to the CLI as an environment variable rather than an argument, and masked in the
log. `changed` exists so a scheduled workflow can skip the upload when production has not moved.

## GitLab CI

`templates/gitlab-ci-pull.yml` defines a hidden job you extend:

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/gorules/cli/cli-v0.3.2/templates/gitlab-ci-pull.yml' # x-release-please-version

pull:rules:
  extends: .gorules-pull
  # project and target normally arrive in the BRMS payload (GRL_PAYLOAD);
  # set GORULES_PROJECT / GORULES_TARGET only for runs that have none

publish:rules:
  needs: ['pull:rules']
  script:
    # dotenv variables are not visible in rules: (evaluated before jobs run) -
    # gate in script when using scheduled pulls with GORULES_CURRENT
    - aws s3 cp "dist/$RULES_PROJECT" "s3://my-bucket/rules/$RULES_PROJECT"
```

`GORULES_URL` and `GORULES_TOKEN` are CI/CD variables; mask and protect the token. GitLab puts them
in the environment automatically, so nothing else is needed to wire them up. Optional job variables:
`GORULES_OUT` (default `dist`), `GORULES_NAME`, `GORULES_CURRENT`, `GORULES_UNPACK` and
`GORULES_DELETE` (both `'false'` by default), and `GORULES_CLI_VERSION`.

The job publishes `RULES_CHANGED`, `RULES_PROJECT`, `RULES_TARGET`, `RULES_VERSION`,
`RULES_RELEASE` and `RULES_SHA256` as a dotenv report, so later jobs read them as ordinary
variables — a deploy job can route on the target (e.g. per-environment buckets) without parsing
anything.

## Azure Pipelines

`templates/azure-pipelines-pull.yml` is a steps template: it pulls the artifact and sets result
variables (`rulesChanged`, `rulesProject`, `rulesTarget`, `rulesVersion`, `rulesRelease`,
`rulesSha256`), and you append your own publish step in the same job:

```yaml
resources:
  repositories:
    - repository: gorules
      type: github
      name: gorules/cli
      ref: refs/tags/cli-v0.3.2 # x-release-please-version
      endpoint: <your GitHub service connection>

jobs:
  - job: deploy_rules
    pool:
      vmImage: ubuntu-latest
    steps:
      - template: templates/azure-pipelines-pull.yml@gorules
        parameters:
          url: https://acme.us1.gorules.io
          # project and target normally arrive in the BRMS payload (GRL_PAYLOAD)

      - script: aws s3 cp "$(Build.ArtifactStagingDirectory)/rules/$(rulesProject)" "s3://my-bucket/rules/$(rulesProject)"
        displayName: Deploy
```

`GORULES_TOKEN` must exist as a secret pipeline variable or in a linked variable group. Azure
DevOps does not map secret variables into the environment automatically, which the template handles
by declaring it explicitly under `env:`.

The job sets `rulesChanged` and `rulesVersion` as pipeline variables for later stages to read.

## Triggered by BRMS

All three templates read `GRL_PAYLOAD` when it is present, which is what BRMS sends when a webhook
triggers the pipeline. The project and target then come from the event rather than from static
configuration, so one pipeline handles every project and environment:

| System          | How the payload arrives                 |
| --------------- | --------------------------------------- |
| GitHub Actions  | `inputs.payload` on `workflow_dispatch` |
| GitLab CI       | `GRL_PAYLOAD` pipeline variable         |
| Azure Pipelines | `GRL_PAYLOAD` run variable              |

Without it, the configured `GORULES_PROJECT` and `GORULES_TARGET` are used, so the same file also
works for a manual or scheduled run.

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
