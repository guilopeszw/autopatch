# Independent application check

**Result: blocked before migration.** On 2026-09-09, AutoPatch was tried against
[Next.js SaaS Starter at `6e33e58b`](https://github.com/nextjs/saas-starter/tree/6e33e58b1e553a41fe22e6b941a7229a002de361),
an independent application template with Stripe checkout, webhooks, and subscription
management. This is an adoption check, not customer validation or a completed upgrade.

## Method and observations

The application was cloned into a disposable directory. Its frozen dependencies
were installed with lifecycle scripts disabled; Next.js generated its route types
and changed `jsx` to `react-jsx`. No payment, database, or deployment commands ran.
Both compiler checks used native APIs in memory without emitting JavaScript.

The CLI received identical schema versions and empty bindings to check the
baseline before mapping an integration. This deliberately tests readiness, not
migration coverage. No application source or compiler options were repaired to
make the result pass.

| Check | Observation |
| --- | --- |
| Application's TypeScript 5.8.3 with its own options | 0 compiler errors |
| AutoPatch's bundled TypeScript 6.0.2 with application options | 2 errors: deprecated `baseUrl` and CSS side-effect import declarations |
| AutoPatch's full gate, including library declarations | 66 errors: those 2 plus 64 dependency declaration errors |
| CLI result | Exit 1, `blocked`, baseline must compile before migration |
| Proposed source edits | 0; checkout unchanged by AutoPatch |
| Application behavior checks / migration review | Not reached |

Dependency errors include Drizzle declaration incompatibilities and unresolved
optional database-driver types. AutoPatch enforces `skipLibCheck: false`; the
application uses `true`. The difference is material even when application source
already passes its own compiler.

## Reproduce the baseline check

From an AutoPatch checkout with dependencies installed; Node.js 24 and pnpm are
required. The recorded run used pnpm 12.3.4.

```sh
AUTOPATCH_ADOPTION_DIR=$(mktemp -d)
git clone https://github.com/nextjs/saas-starter.git "$AUTOPATCH_ADOPTION_DIR/app"
git -C "$AUTOPATCH_ADOPTION_DIR/app" checkout 6e33e58b1e553a41fe22e6b941a7229a002de361
(cd "$AUTOPATCH_ADOPTION_DIR/app" && pnpm install --frozen-lockfile --ignore-scripts && pnpm exec next typegen)
printf '{"operations":{},"schemas":{}}\n' > "$AUTOPATCH_ADOPTION_DIR/bindings.json"
npm run autopatch -- \
  --from examples/stripe/target.json --to examples/stripe/target.json \
  --project "$AUTOPATCH_ADOPTION_DIR/app/tsconfig.json" \
  --bindings "$AUTOPATCH_ADOPTION_DIR/bindings.json" \
  --report "$AUTOPATCH_ADOPTION_DIR/review.html" --json
```

## What this changes in our priorities

Before claiming broad application support, establish a compatible compiler and
clean dependency baseline for an independent project. This check does not justify
suppressing errors to produce a patch. The application also consumes installed
`Stripe.Subscription` types directly; AutoPatch currently binds local exported
interfaces and will not rewrite `node_modules`.

The next adoption milestone is one supported migration in an independent
application with an explicit local contract and meaningful application checks.
Configuration effort was four setup steps above; binding effort, review time,
customer savings, and willingness to pay remain unmeasured. See the
[customer validation protocol](customer-validation.md).
