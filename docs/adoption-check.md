# Independent application check

**Result: one supported migration completed after manual compatibility work.**
On September 9, 2026, AutoPatch renamed an existing billing helper and its caller
in [Next.js SaaS Starter at `6e33e58b`](https://github.com/nextjs/saas-starter/tree/6e33e58b1e553a41fe22e6b941a7229a002de361).
This is an independent application template, not a customer project.

## What passed

The authored local contract renames `getStripePrices` to `listStripePrices`.
AutoPatch changed only the helper declaration and the pricing page's import/call.
Preview left the checkout unchanged; applying the patch passed the full in-memory
compiler gate with **zero errors**. No LLM was used.

Before and after, the actual helper and Stripe SDK made the same recurring-price
request to a loopback HTTPS server and returned identical amounts, currencies,
intervals, product IDs, and trial lengths. Responses were test data. No provider
account, payment, database query, or deployment was involved. This is **not an
announced Stripe API change** or a full SDK upgrade.

## Compatibility work and limits

The original application was blocked before migration:

| Baseline check | Errors |
| --- | ---: |
| Application's TypeScript 5.8.3 and original options | 0 |
| AutoPatch's TypeScript 6.0.2 and application options | 2 |
| AutoPatch's full gate, including dependency declarations | 66 |

The two application-option errors concern deprecated `baseUrl` and a CSS import
declaration. The remaining 64 concern dependency declarations. AutoPatch proposed
no edits to this failing baseline.

A separate, checked-in preparation patch removes `baseUrl`, declares side-effect
CSS imports, pins TypeScript 6.0.3 and Drizzle **1.0.0-rc.5-ab785fc**, and adapts the
application's Drizzle relation setup and query syntax. It sets `skipLibCheck: false`;
the compiler gate remains unchanged. The Drizzle release candidate is an explicit
experimental dependency, **not a production upgrade recommendation**. Database,
authentication, and checkout behavior after that manual preparation remain untested.

## Reproduce and review

Requires Node.js 24, Git, pnpm (recorded: 12.3.4), OpenSSL, and internet access:

```sh
npm ci
npm run test:adoption
```

The opt-in test clones the pinned application, applies the compatibility patch,
installs frozen dependencies, and runs preview, apply, and the runtime checks.
It prints a retained temporary directory containing `review.html`,
`migration.patch`, `observations.json`, `measurements.json`, and the checkout.
The default test suite skips this networked test. See
[fixture provenance](../tests/fixtures/independent-starter/README.md).

| Recorded machine elapsed time | Seconds |
| --- | ---: |
| Clone, install, and compatibility preparation | 22.57 |
| Preview and report | 6.56 |
| Apply and behavior check | 10.27 |

These are one local run with an existing package cache. They exclude the manual
compatibility investigation and are not human setup time or time saved.
The project owner agreed to a guided review; feedback and review duration remain
pending. [Customer validation](customer-validation.md) is still outstanding.
