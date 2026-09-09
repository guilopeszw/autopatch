# GitHub migration workflow

When a checked-in target schema changes, the workflow runs AutoPatch and opens a
**draft PR** containing verified source edits, an updated schema baseline, and
review evidence. Blocked migrations produce findings without a source commit.
For automatic upstream polling and application checks, use [scheduled monitoring](monitoring.md).

## Setup and inputs

`.github/workflows/autopatch.yml` runs on a main-branch change to an example's
`target.json` or `autopatch.json`, and through **Actions → AutoPatch migrations →
Run workflow**. It runs Stripe, Paddle, Chargebee, and Recurly independently. Source schemas are
checked in; the workflow does not poll upstream URLs. The initial examples
intentionally have pending migrations, so the first run can produce four PRs.
See [provider scope](../examples/README.md) and [observed draft PRs](delivery-evidence.md).

Each `examples/<provider>/autopatch.json` maps four repository-relative paths:
`from` (recorded baseline), `to` (desired target), `project` (tsconfig), and
`bindings` (local SDK exports). To adopt another target, supply the same four
paths and update the workflow matrix/trigger paths. No provider plugin is needed.

The preparation command runs in a **clean, disposable Git checkout**:

```sh
node --import tsx scripts/prepare-migration-pr.ts --config examples/paddle/autopatch.json --output /tmp/paddle-pr-artifacts
```

The output directory must be new, its parent must exist, and it must be outside
the repository. Inputs must be tracked files with no symlinks. The command uses
the shared typed file planner to plan and export `review.html` and `result.json`, then checks
that each proposed source edit is tracked, revalidates with the standard writer,
advances the schema baseline and renamed operation bindings, and stages exactly those paths. It also writes
`manifest.json` and `body.md`. It never pushes or opens a PR on its own.

Exit 0 means `ready` or `noop`; exit 1 means compiler/contract blocking; exit 2
means invalid input or an operational failure. The workflow publishes nothing
after a nonzero exit. Planning failures produce reports where possible. A later
filesystem failure can leave local edits in the disposable checkout: discard it,
do not commit it. Source persistence retains the existing per-file atomicity
limits; Git publication is gated on successful completion and repository checks.

## Publication and reruns

Only the default branch may run the write-capable job. Fork PRs and arbitrary
dispatch refs cannot trigger it. The job receives `contents: write` and
`pull-requests: write`; the repository's default token permissions remain read.
Enable **Settings → Actions → General → Allow GitHub Actions to create and
approve pull requests** so its token can create draft PRs. This workflow never
approves or merges them. It uses no financial API keys or model credentials.

The workflow runs repository checks before creating a Conventional Commit and
pushing a new branch. The branch includes provider and source commit SHA. A retry
finds and links an existing PR, including closed PRs, instead of duplicating it.
It never force-pushes. A branch left without a PR after an interrupted run causes
an explicit failure for inspection. Different source commits can produce separate
PRs; review or close superseded PRs manually. Baseline advancement makes the same
target a no-op after its migration is merged. Updating operation keys and exports
also keeps the next operation rename bound to the correct declaration. Configured
property defaults should be reviewed when renaming or changing their contracts.

HTML and JSON artifacts are attached to the workflow run for seven days. Their
access follows GitHub's repository and artifact-download rules; this MVP is public.
PR bodies link to that run. GitHub may require human approval before running PR
checks generated using `GITHUB_TOKEN`; the originating run has already executed
the repository checks. See [GitHub's workflow trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

The default pipeline proposes changes; it does not auto-merge, deploy, or execute
the target application's production operations. Compiler success is evidence of
type consistency, not complete behavioral correctness.
