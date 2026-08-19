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
npx @gorules/cli@0.3.0 pull --project pricing --target env:production # x-release-please-version
```

## GitHub Actions

The composite action lives at `actions/pull` **in this repository**, so the tag you pin is the CLI
version you get. There is no separate marketplace listing to track.

### Prerequisites

- Nothing to install. The action runs the CLI through `npx`, and every GitHub-hosted runner already
  ships Node and `jq`. On a **self-hosted runner** make sure both are on `PATH`.
- A repository or environment secret holding the access token. A read-scoped project token is
  enough — the CLI only ever downloads.

### Minimal workflow

```yaml
name: Pull rules

on:
  schedule:
    - cron: '*/15 * * * *'
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
      - uses: gorules/cli/actions/pull@cli-v0.3.0 # x-release-please-version
        id: rules
        with:
          url: https://acme.us1.gorules.io
          token: ${{ secrets.GORULES_TOKEN }}
          project: pricing
          target: env:production
          out: ./dist

      - run: aws s3 cp ./dist/ s3://my-bucket/rules/live/ --recursive
        if: steps.rules.outputs.changed == 'true'
```

### Inputs

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

### Outputs

| Output                           | Description                                                     |
| -------------------------------- | --------------------------------------------------------------- |
| `changed`                        | `false` when `current` still matched, so nothing was downloaded |
| `release` / `version` / `commit` | What the target resolved to                                     |
| `sha256`                         | Checksum of the downloaded artifact                             |
| `files`                          | JSON array of paths written                                     |

Outputs are read as `steps.<id>.outputs.<name>`, so the step needs an `id`. To use them in a
**different job**, re-export them through the job's own `outputs` block:

```yaml
jobs:
  rules:
    runs-on: ubuntu-latest
    outputs:
      changed: ${{ steps.rules.outputs.changed }}
      version: ${{ steps.rules.outputs.version }}
    steps:
      - uses: gorules/cli/actions/pull@cli-v0.3.0 # x-release-please-version
        id: rules
        with:
          url: https://acme.us1.gorules.io
          token: ${{ secrets.GORULES_TOKEN }}
          project: pricing
          target: env:production

      - uses: actions/upload-artifact@v4
        with:
          name: rules
          path: pricing

  deploy:
    needs: rules
    if: needs.rules.outputs.changed == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploying rules ${{ needs.rules.outputs.version }}"
```

### Baking rules into an image

`unpack: true` writes the decision files as a directory instead of a zip, which is what you want
for a `COPY` into a container:

```yaml
- uses: gorules/cli/actions/pull@cli-v0.3.0 # x-release-please-version
  with:
    url: https://acme.us1.gorules.io
    token: ${{ secrets.GORULES_TOKEN }}
    project: pricing
    target: env:production
    out: ./rules
    name: '.' # extract straight into ./rules, no sub-directory
    unpack: true
    delete: true # mirror the target exactly; drop rules deleted upstream

- run: docker build -t myapp:${{ github.sha }} .
```

### Skipping work when nothing moved

Pass the release or commit id you already hold as `current`. The server answers "no change", the
action downloads nothing and sets `changed=false` instead of failing:

```yaml
- uses: actions/cache@v4
  id: state
  with:
    path: .rules-state
    key: rules-${{ github.ref_name }}

- id: prev
  run: echo "id=$(cat .rules-state 2>/dev/null || echo '')" >> "$GITHUB_OUTPUT"

- uses: gorules/cli/actions/pull@cli-v0.3.0 # x-release-please-version
  id: rules
  with:
    url: https://acme.us1.gorules.io
    token: ${{ secrets.GORULES_TOKEN }}
    project: pricing
    target: env:production
    current: ${{ steps.prev.outputs.id }}

- if: steps.rules.outputs.changed == 'true'
  run: echo "${{ steps.rules.outputs.release }}" > .rules-state
```

The token is passed to the CLI as an environment variable rather than an argument — anything on a
command line is visible to other processes and lands in traces — and is masked in the log.

## GitLab CI

`templates/gitlab-ci-pull.yml` defines a hidden job, `.gorules-pull`, that you `extends:`.

### Prerequisites

- Two CI/CD variables under **Settings → CI/CD → Variables**: `GORULES_URL` and `GORULES_TOKEN`.
  Mark the token **Masked** and **Protected**. GitLab puts CI/CD variables into the job environment
  automatically, so the CLI picks them up with no further wiring — the template never names them.
- Nothing else. The job brings its own Node image.

### Minimal pipeline

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/gorules/cli/cli-v0.3.0/templates/gitlab-ci-pull.yml' # x-release-please-version

pull:rules:
  extends: .gorules-pull
  variables:
    GORULES_PROJECT: pricing
    GORULES_TARGET: env:production

publish:rules:
  needs: ['pull:rules']
  rules:
    - if: $RULES_CHANGED == "true"
  script:
    - aws s3 cp dist/ s3://my-bucket/rules/live/ --recursive
```

### Job variables

Set these under the extending job's `variables:` block:

| Variable              | Default   | Description                                              |
| --------------------- | --------- | -------------------------------------------------------- |
| `GORULES_PROJECT`     | —         | Project key or id; taken from the payload when triggered |
| `GORULES_TARGET`      | `main`    | Target to resolve                                        |
| `GORULES_OUT`         | `dist`    | Output directory, also the artifact path                 |
| `GORULES_NAME`        | —         | Output file or sub-directory name                        |
| `GORULES_UNPACK`      | `'false'` | `'true'` to extract the archive                          |
| `GORULES_DELETE`      | `'false'` | With unpack, mirror the target exactly                   |
| `GORULES_CURRENT`     | —         | Release or commit id already held                        |
| `GORULES_CLI_VERSION` | pinned    | Version of `@gorules/cli` to run                         |

Quote the booleans. GitLab variables are strings, and the template compares against the literal
`true`.

### Passing results downstream

The job writes a **dotenv report**, so later jobs read the results as ordinary variables — no
artifact parsing:

| Variable        | Description                                    |
| --------------- | ---------------------------------------------- |
| `RULES_CHANGED` | `'true'` / `'false'`                           |
| `RULES_VERSION` | Release version, when the target was a release |
| `RULES_RELEASE` | Release id                                     |
| `RULES_SHA256`  | Checksum of the downloaded artifact            |

The pulled files are published as a job artifact at `$GORULES_OUT`, so a downstream job gets them
by declaring `needs: ['pull:rules']`.

### Scheduled pulls

Create a pipeline schedule (**Build → Pipeline schedules**) and gate the job on it, so pushes do
not re-pull:

```yaml
pull:rules:
  extends: .gorules-pull
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - if: $CI_PIPELINE_SOURCE == "web"
  variables:
    GORULES_PROJECT: pricing
    GORULES_TARGET: env:production
    GORULES_CURRENT: $RULES_RELEASE_LAST # e.g. from a schedule variable
```

## Azure Pipelines

`templates/azure-pipelines-pull.yml` is a **job** template, so you reference it under `jobs:`, not
`steps:`.

### Prerequisites

- A **GitHub service connection** so the pipeline can resolve this repository as a template source,
  declared under `resources.repositories`.
- `GORULES_TOKEN` as a **secret** pipeline variable, or in a linked variable group. Azure does not
  map secret variables into the process environment automatically — the template handles that by
  naming it explicitly under the step's `env:`.
- For blob upload, an **ARM service connection** (`azureSubscription`) whose identity has
  _Storage Blob Data Contributor_ on the target account; the template uploads with `--auth-mode
login`, not account keys.

### Minimal pipeline

```yaml
resources:
  repositories:
    - repository: gorules
      type: github
      name: gorules/cli
      ref: refs/tags/cli-v0.3.0 # x-release-please-version
      endpoint: <your GitHub service connection>

jobs:
  - template: templates/azure-pipelines-pull.yml@gorules
    parameters:
      url: https://acme.us1.gorules.io
      project: pricing
      target: env:production
      azureSubscription: <your ARM service connection>
      storageAccount: acmerules
      container: rules
```

### Parameters

| Parameter           | Default                                   | Description                              |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| `url`               | —                                         | BRMS URL                                 |
| `project`           | —                                         | Project key or id                        |
| `target`            | `main`                                    | Target to resolve                        |
| `out`               | `$(Build.ArtifactStagingDirectory)/rules` | Output directory                         |
| `name`              | `''`                                      | Output file or sub-directory name        |
| `unpack`            | `false`                                   | Extract the archive                      |
| `delete`            | `false`                                   | With unpack, mirror the target exactly   |
| `cliVersion`        | pinned                                    | Version of `@gorules/cli` to run         |
| `azureSubscription` | `''`                                      | ARM service connection for blob upload   |
| `storageAccount`    | `''`                                      | Target storage account                   |
| `container`         | `''`                                      | Target container; blank skips the upload |
| `prefix`            | `rules/live`                              | Blob path prefix                         |

Leave `container` blank and the upload step is skipped entirely, which is what you want if you
intend to consume the files some other way.

### Reading the results

The template sets `rulesChanged` and `rulesVersion` with `##vso[task.setvariable]`. These are
visible to **later steps in the same job**. Azure does not carry them into other jobs or stages
unless they are declared as job outputs, which this template does not currently do — so branch on
them within the job, or upload the files as a pipeline artifact and let the next stage consume
that instead.

### Publishing the files instead of uploading to Blob Storage

The default `out` is the artifact staging directory, but the template does not publish it. Add
your own job that depends on the template's job if you want a pipeline artifact:

```yaml
jobs:
  - template: templates/azure-pipelines-pull.yml@gorules
    parameters:
      url: https://acme.us1.gorules.io
      project: pricing
      target: env:production

  - job: publish
    dependsOn: gorules_pull
    steps:
      - task: PublishPipelineArtifact@1
        inputs:
          targetPath: $(Build.ArtifactStagingDirectory)/rules
          artifact: rules
```

### Accepting BRMS-triggered runs

For a webhook-driven run the pipeline must accept `GRL_PAYLOAD` at queue time: add a pipeline
variable named `GRL_PAYLOAD` (any value) with **"Let users override this value when running this
pipeline"** checked. Organizations with _Limit variables that can be set at queue time_ enabled —
the default on newer organizations — reject the queue request otherwise.

## Triggered by BRMS

All three templates read `GRL_PAYLOAD` when it is present, which is what BRMS sends when a webhook
triggers the pipeline. The project and target then come from the event rather than from static
configuration, so one pipeline handles every project and environment:

| System          | How the payload arrives                 | What you must declare                           |
| --------------- | --------------------------------------- | ----------------------------------------------- |
| GitHub Actions  | `inputs.payload` on `workflow_dispatch` | A `payload` input on `workflow_dispatch`        |
| GitLab CI       | `GRL_PAYLOAD` pipeline variable         | Nothing                                         |
| Azure Pipelines | `GRL_PAYLOAD` run variable              | A queue-time-overridable `GRL_PAYLOAD` variable |

The payload carries `project.key` (or `projectId`) and `target`; each template reads those two
fields and exports them as `GORULES_PROJECT` and `GORULES_TARGET`.

Without a payload the configured project and target are used, so the same file also works for a
manual or scheduled run. `project` is therefore only mandatory when you have no payload — declare
it anyway unless the pipeline is webhook-only.

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
