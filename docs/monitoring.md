# Scheduled monitoring

AutoPatch polls a public GitHub OpenAPI source, plans supported changes, runs
configured application checks, and opens a **draft PR**. A person reviews and
merges it. AutoPatch never approves, merges, or deploys changes.

## Try a preview

From this checkout, with Node.js 24 and `npm ci` completed:

```sh
AUTOPATCH_MONITOR_DIR=$(mktemp -d)
npm run monitor -- --config monitors/stripe.json --output "$AUTOPATCH_MONITOR_DIR/report"
```

This downloads a pinned upstream revision and produces reports without modifying
source files or running application code. Inputs must be tracked, nonsymlink
files in a clean Git checkout. The output directory must be new, outside the
checkout, with an existing parent. Untracked files are ignored.

Add `--prepare` **in a disposable checkout** to write and stage verified source
edits, advance both configured schema snapshots, and run the approved checks.
This command does not push or create a PR. Planning and writing both use strict,
in-memory TypeScript diagnostics; monitoring does not enable AI repair.

## Configure your application

Start from [the four monitor configs](../monitors/). Each config contains:

| Field | Meaning |
| --- | --- |
| `id` | Stable, unique name for branches and notices, such as `stripe` |
| `migration` | Tracked JSON mapping `from`, `to`, `project`, and `bindings` to repository-relative files |
| `source` | Public GitHub `repository`, `ref`, and JSON/YAML `path` |
| `schemas` | Schema names mapped to selected property names, or `"*"` for a complete schema |
| `verify` | One or more approved command arrays, such as `["npm", "test"]` |

The `from` snapshot must describe your current local adapter. Set bindings using
[the CLI guide](usage.md#bindings). The monitor builds a new target from upstream;
`to` identifies the tracked snapshot to update alongside `from` when preparing.
Use a separate monitor ID for each independent integration.

Commands run in the application repository after patching. Install application
dependencies before invoking the action. Commands are trusted code, not sandboxed;
choose offline tests that need no production credentials. Each command has a
120-second timeout and a 1 MB capture limit. Artifacts retain the last 64,000
characters of each output stream. GitHub publication credentials are supplied
only to the later publishing step.

## Run in GitHub Actions

This repository's [monitor workflow](../.github/workflows/monitor.yml) polls the
four providers daily at **08:17 UTC**, with manual dispatch available. Scheduled
runs begin after the workflow is merged into the default branch. GitHub can delay
scheduled runs; this is not a real-time alert service.

For another repository, commit the configuration and add a workflow like this.
Replace `<reviewed-commit-sha>` with the full SHA of a reviewed AutoPatch revision:

```yaml
name: Monitor billing API
on:
  schedule:
    - cron: '17 8 * * *'
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: autopatch-billing
  cancel-in-progress: false
jobs:
  monitor:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
          fetch-depth: 0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version: '24'
      - run: npm ci
      - uses: guilopeszw/autopatch@<reviewed-commit-sha>
        with:
          config: monitors/stripe.json
          token: ${{ github.token }}
```

The action permits only default-branch runs. Enable GitHub's repository setting
allowing Actions to create pull requests. Its name also mentions approval;
AutoPatch never calls approval or merge APIs. Keep your normal review rules.
For a personal token or custom GitHub App, also set the action's `issue-author`
input to that token's actual GitHub login, including `[bot]` when applicable.
The publishing CLI exposes the same setting as `--issue-author`.

## Results and recovery

| Status | Result |
| --- | --- |
| `ready` | Preview has a verified plan; publication additionally requires preparation and passing application checks |
| `unchanged` | No changes in the monitored contract; no new PR |
| `blocked` | Unsupported change, compiler failure, or preparation/check failure; no PR |
| `failed` | Download, configuration, or another operational error; no PR |

CLI exit codes are 0 for ready/unchanged, 1 for blocked, and 2 for failed.
Actions retain available snapshots, exact edits, HTML review, check output, and
source revision/hash for **30 days**. Read `checks.json` for application failures,
`failure.txt` for preparation failures, and `result.json` for migration findings.
Artifact access follows the host repository's GitHub access rules.

Publication reuses an existing PR, including a closed PR, for the same update.
It never force-pushes or overwrites reviewer edits. An interrupted push/PR attempt
can resume after unrelated base changes only when the existing patch and its
merged tree match the freshly verified candidate. Otherwise it stops for review.

Blocked/failed polls create or update one GitHub issue per monitor. Identical
retries stay quiet; recovery closes the notice. The publisher scans at most 1,000
issues, then stops rather than risking duplicates. A publishing failure fails the
Actions run; check its logs and rerun after correcting permissions or connectivity.
Failed preparation restores unchanged AutoPatch replacements where possible and
preserves concurrent edits or deletions. Discard the checkout after failure.

## Scope

Monitoring covers selected schema fields and their local schema references.
Endpoint changes, authentication, unselected fields, remote schema references,
whole SDK upgrades, and billing policy are outside this monitor's scope. Sources
must be public GitHub OpenAPI 3.0/3.1 JSON or YAML, at most 25 MB and 100 selected
or referenced schemas. Downloads retry transient request failures up to three times.

The included application checks verify small authored adapters. They do not
establish complete provider compatibility or customer savings. See
[provider coverage](../examples/README.md) and [test evidence](evaluation.md).
For checked-in target updates without polling, use [the earlier workflow](schema-migration-workflow.md).
