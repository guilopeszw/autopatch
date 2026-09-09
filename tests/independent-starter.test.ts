import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test, expect } from 'vitest';
import { runCli } from '../src/cli.js';

/** Opt-in adoption evidence: downloads a pinned independent app and retains its review artifacts. */
test.skipIf(process.env.AUTOPATCH_ADOPTION !== '1')('migrates an independent billing helper while preserving actual SDK request and price observations', async () => {
  const fixture = resolve('tests/fixtures/independent-starter');
  const provenance = JSON.parse(readFileSync(join(fixture, 'provenance.json'), 'utf8')) as {
    repository: string; revision: string; compatibilityPatchSha256: string;
  };
  const patch = readFileSync(join(fixture, 'compatibility.patch'));
  expect(createHash('sha256').update(patch).digest('hex')).toBe(provenance.compatibilityPatchSha256);
  const output = mkdtempSync(join(tmpdir(), 'autopatch-independent-starter-'));
  const root = join(output, 'application'); mkdirSync(root);
  const environment = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  const logs: string[] = [];
  const command = (executable: string, args: string[]): string => {
    const text = execFileSync(executable, args, { cwd: root, env: environment, encoding: 'utf8', timeout: 120_000, maxBuffer: 10_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    logs.push(`${executable} ${args.join(' ')}\n${text}`); return text;
  };
  const start = performance.now();
  try {
    command('git', ['init', '-b', 'main']);
    command('git', ['remote', 'add', 'origin', provenance.repository]);
    command('git', ['fetch', '--depth', '1', 'origin', provenance.revision]);
    command('git', ['checkout', '--detach', 'FETCH_HEAD']);
    expect(command('git', ['rev-parse', 'HEAD']).trim()).toBe(provenance.revision);
    command('git', ['apply', join(fixture, 'compatibility.patch')]);
    command('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts']);
    command('pnpm', ['exec', 'next', 'typegen']);
    command('git', ['add', '.']);
    command('git', ['-c', 'user.name=AutoPatch test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: prepare a compatible application baseline']);
    const setupSeconds = (performance.now() - start) / 1_000;
    const observe = (name: string): unknown => JSON.parse(execFileSync(process.execPath,
      ['--import', resolve('node_modules/tsx/dist/loader.mjs'), join(fixture, 'check.mjs'), name], {
        cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000,
        env: { ...environment, ADOPTION_ROOT: root, TSX_TSCONFIG_PATH: join(root, 'tsconfig.json'),
          STRIPE_SECRET_KEY: 'sk_test_autopatch_offline', POSTGRES_URL: 'postgres://unused:unused@127.0.0.1:1/unused', AUTH_SECRET: 'offline-test-only' },
      }));
    const before = observe('getStripePrices');
    const common = ['--from', join(fixture, 'before.json'), '--to', join(fixture, 'after.json'),
      '--project', join(root, 'tsconfig.json'), '--bindings', join(fixture, 'bindings.json'), '--json'];
    const planStart = performance.now();
    let preview = '';
    expect(await runCli([...common, '--report', join(output, 'review.html')], { out: text => preview += text, err: text => logs.push(text) })).toBe(0);
    const result = JSON.parse(preview) as { status: string; diagnostics: unknown[]; files: { path: string }[] };
    expect(result.status).toBe('verified'); expect(result.diagnostics).toEqual([]);
    expect(result.files.map(file => relative(root, file.path))).toEqual(['app/(dashboard)/pricing/page.tsx', 'lib/payments/stripe.ts']);
    expect(command('git', ['status', '--porcelain'])).toBe('');
    const previewSeconds = (performance.now() - planStart) / 1_000;
    const writeStart = performance.now();
    let written = '';
    expect(await runCli([...common, '--write'], { out: text => written += text, err: text => logs.push(text) })).toBe(0);
    expect(JSON.parse(written)).toMatchObject({ status: 'verified', written: true, diagnostics: [] });
    const after = observe('listStripePrices');
    assert(before && after && typeof before === 'object' && typeof after === 'object');
    expect({ ...after, name: undefined }).toEqual({ ...before, name: undefined });
    writeFileSync(join(output, 'result.json'), written);
    writeFileSync(join(output, 'migration.patch'), command('git', ['diff', '--binary', '--full-index']));
    writeFileSync(join(output, 'observations.json'), JSON.stringify({ before, after }, null, 2));
    writeFileSync(join(output, 'measurements.json'), JSON.stringify({ sourceRevision: provenance.revision,
      setupSeconds, previewSeconds, writeAndCheckSeconds: (performance.now() - writeStart) / 1_000,
      proposedFiles: result.files.length, compilerErrors: 0, humanSetupMinutes: null, humanReviewMinutes: null }, null, 2));
    console.log(`Independent application evidence: ${output}`);
  } finally {
    writeFileSync(join(output, 'setup.log'), logs.join('\n'));
    console.log(`Retained checkout and logs: ${dirname(root)}`);
  }
}, 300_000);
