# Observed GitHub delivery

The live monitor published four draft migration PRs on September 9, 2026.
[First run](https://github.com/guilopeszw/autopatch/actions/runs/34408612417)
and [repeat run](https://github.com/guilopeszw/autopatch/actions/runs/34408759564)
both passed all four provider jobs from merged automation commit `9f6482d`.
The repeat reused the same PRs and commit heads; it created no duplicates.

| Provider | Draft PR | Source change |
| --- | --- | --- |
| Stripe | [#18](https://github.com/guilopeszw/autopatch/pull/18) | Align subscription period fields and cancellation nullability |
| Paddle | [#19](https://github.com/guilopeszw/autopatch/pull/19) | Require the customer-portal payment-update link |
| Chargebee | [#20](https://github.com/guilopeszw/autopatch/pull/20) | Add `paused` to the local subscription status union |
| Recurly | [#21](https://github.com/guilopeszw/autopatch/pull/21) | Require pause length with an explicitly configured one-cycle value |

Each job fetched its configured upstream contract, prepared a compiler-verified
patch, ran application checks, and published a draft using a Conventional Commit.
Diffs contain the selected example's schema snapshots and expected TypeScript
changes. The PRs remain unmerged: **human approval is required**.

These are bounded example adapters. Stripe uses a historical release baseline;
the other three monitor baselines are authored. No provider account, payment,
or LLM request was involved. This does not establish full SDK upgrade coverage.
See [test evidence](evaluation.md) for the separate historical Paddle case.

## Notices and recovery

A synthetic failure exercised the publisher against the real GitHub API with the
repository owner's token. With the correct `--issue-author guilopeszw`, two
identical failure retries made no mutations; recovery updated and closed
[the existing notice #23](https://github.com/guilopeszw/autopatch/issues/23).

The initial smoke command used the wrong author login and created notices #22
and #23. Both were closed after the check. This was test configuration error,
not a provider outage. Custom tokens must configure their actual GitHub login;
the scheduled workflow uses the default `github-actions[bot]` identity.

## Artifacts and earlier delivery

Monitor artifacts contain manifests, JSON plans, HTML reports, and application
check results, with 30-day retention. GitHub may require sign-in to download them;
the public PR diffs remain available after artifacts expire.

The earlier [checked-schema workflow run](https://github.com/guilopeszw/autopatch/actions/runs/34388285320)
created demonstration PRs #10–13 before live monitoring was added. Those artifacts
had seven-day retention. They are separate from the live monitor runs above.
