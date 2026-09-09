import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { runCli } from '../src/cli.js';

const execute = promisify(execFile);
const tsxLoader = createRequire(resolve('package.json')).resolve('tsx');

for (const [provider, before, after] of [
  ['paddle', { cancelUrl: 'https://example.invalid/cancel' }, { cancelUrl: 'https://example.invalid/cancel' }],
  ['chargebee', { active: true }, { active: true }],
  ['recurly', {}, { remaining_pause_cycles: 1 }],
] as const) {
  test(`maintains the documented ${provider} billing adapter through the generic CLI`, async () => {
    const fixture = resolve(`tests/fixtures/billing/${provider}`);
    const provenance = JSON.parse(readFileSync(join(fixture, 'provenance.json'), 'utf8')) as { files: Record<string, string> };
    for (const [path, digest] of Object.entries(provenance.files)) {
      expect(createHash('sha256').update(readFileSync(join(fixture, path))).digest('hex'), path).toBe(digest);
    }
    const root = mkdtempSync(join(tmpdir(), `autopatch-billing-${provider}-`));
    try {
      cpSync(join(fixture, 'project'), root, { recursive: true });
      // These small repository-owned adapters only return local values. The
      // engine itself never executes target code or performs a billing action.
      const observe = async () => {
        const { stdout } = await execute(process.execPath, ['--import', tsxLoader, '--input-type=module', '--eval', `
          import { pathToFileURL } from 'node:url';
          const { observe } = await import(pathToFileURL(process.env.AUTOPATCH_CONSUMER).href);
          console.log(JSON.stringify(observe()));
        `], { timeout: 5000, env: { ...process.env, AUTOPATCH_CONSUMER: join(root, 'consumer.ts') } });
        return JSON.parse(stdout) as unknown;
      };
      expect(await observe()).toEqual(before);
      let output = '';
      expect(await runCli(['--from', join(fixture, 'baseline.json'), '--to', join(fixture, 'target.json'),
        '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json', '--report', join(root, 'review.html')],
      { out: text => { output += text; }, err: () => {} }), output).toBe(0);
      const result = JSON.parse(output);
      expect(result).toMatchObject({ status: 'verified', written: true, llmAttempts: 0, diagnostics: [] });
      expect(result.changes).toHaveLength(1);
      expect(await observe()).toEqual(after);
      expect(readFileSync(join(root, 'review.html'), 'utf8')).toContain('Bound symbol:');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  test(`blocks a ${provider} billing migration when its consumer needs a policy decision`, async () => {
    const fixture = resolve(`tests/fixtures/billing/${provider}`);
    const root = mkdtempSync(join(tmpdir(), `autopatch-billing-${provider}-blocked-`));
    try {
      cpSync(join(fixture, 'project'), root, { recursive: true });
      if (provider === 'paddle') writeFileSync(join(root, 'consumer.ts'),
        'import type { CustomerPortalSessionUrlsSubscriptionsItem } from "./api.js";\nexport const urls: CustomerPortalSessionUrlsSubscriptionsItem = { id: "sub_example", cancel_subscription: "https://example.invalid/cancel" };\n');
      if (provider === 'chargebee') writeFileSync(join(root, 'consumer.ts'),
        'import type { Subscription } from "./api.js";\nexport function label(s: Subscription): string { switch(s.status) { case "future": case "in_trial": case "active": case "non_renewing": case "cancelled": case "transferred": return s.status; } }\n');
      if (provider === 'recurly') {
        const bindings = JSON.parse(readFileSync(join(root, 'bindings.json'), 'utf8'));
        delete bindings.schemas.SubscriptionPause.defaults;
        writeFileSync(join(root, 'bindings.json'), JSON.stringify(bindings));
      }
      const original = readFileSync(join(root, 'api.ts'), 'utf8');
      const consumer = readFileSync(join(root, 'consumer.ts'), 'utf8');
      let output = '';
      expect(await runCli(['--from', join(fixture, 'baseline.json'), '--to', join(fixture, 'target.json'),
        '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json'],
      { out: text => { output += text; }, err: () => {} }), output).toBe(1);
      const report = JSON.parse(output);
      expect(report).toMatchObject({ status: 'blocked', written: false, files: [], llmAttempts: 0 });
      expect(report.diagnostics.length).toBeGreaterThan(0);
      expect(readFileSync(join(root, 'api.ts'), 'utf8')).toBe(original);
      expect(readFileSync(join(root, 'consumer.ts'), 'utf8')).toBe(consumer);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
