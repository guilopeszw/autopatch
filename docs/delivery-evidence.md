# Observed GitHub delivery

On September 9, 2026, the default-branch workflow completed all four provider
jobs successfully at source commit `4ae5ed3e8e295360eefd4d87cd8a8b65f69d3a0f`.
[Recorded run](https://github.com/guilopeszw/autopatch/actions/runs/34388285320).
This is observed PR publication, not only a checked-in workflow or local test.

| Provider | Actual draft PR | Source changes |
| --- | --- | --- |
| Chargebee | [#10](https://github.com/guilopeszw/autopatch/pull/10) | Add `paused` to the local subscription status union |
| Recurly | [#11](https://github.com/guilopeszw/autopatch/pull/11) | Require pause length and insert the explicitly configured one-cycle value |
| Paddle | [#12](https://github.com/guilopeszw/autopatch/pull/12) | Add the required customer-portal payment-update link |
| Stripe | [#13](https://github.com/guilopeszw/autopatch/pull/13) | Remove retired period fields and update cancellation nullability |

Each PR was created by `github-actions[bot]`, uses a Conventional Commit,
advances its recorded schema baseline, and remains a draft for demonstration.
Exact diffs were inspected: only the selected example's baseline and expected
TypeScript files change. The originating jobs run the compiler gate, repository
tests, and demo before pushing their branches. Their downloadable artifacts
contain JSON plans, HTML reports, manifests, and PR body text.

This demonstrates GitHub delivery of the bounded examples. Only the Stripe
workflow example is a historical release pair; the other three workflow baselines
are authored. The separate historical Paddle currency case is documented in
[the evaluation protocol](evaluation.md). No provider account, payment, or LLM
request was involved. The demo PRs are intentionally not merged.

Artifacts expire after seven days under the workflow retention setting. The
repository and PR diffs are public; GitHub may require sign-in for Actions
artifact downloads. The PR links above preserve the proposed source changes.
