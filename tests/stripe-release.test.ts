import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { runCli } from '../src/cli.js';

const execute = promisify(execFile);
const fixture = resolve('tests/fixtures/stripe');

test('migrates the published Acacia to Basil subscription slice and preserves account display behavior', async () => {
  const provenance = JSON.parse(readFileSync(join(fixture, 'provenance.json'), 'utf8')) as { files: Record<string, string> };
  for (const [path, hash] of Object.entries(provenance.files)) {
    expect(createHash('sha256').update(readFileSync(join(fixture, path))).digest('hex'), path).toBe(hash);
  }
  // Preserve every keyword on selected upstream properties, including format and
  // maxLength. This fixture is a projection, never a rewritten target contract.
  for (const [side, version] of [['before', 'v1'], ['after', 'v2']]) {
    const upstream = JSON.parse(readFileSync(join(fixture, `upstream/${side}.json`), 'utf8'));
    const projected = JSON.parse(readFileSync(join(fixture, `${version}.json`), 'utf8'));
    const full = upstream.components.schemas.subscription;
    const selected = projected.components.schemas.subscription;
    expect(projected.info.version).toBe(upstream.info.version);
    for (const [name, property] of Object.entries(selected.properties)) expect(property).toEqual(full.properties[name]);
    expect(selected.required).toEqual(full.required.filter((name: string) => name in selected.properties));
  }
  const root = mkdtempSync(join(tmpdir(), 'autopatch-stripe-'));
  try {
    cpSync(join(fixture, 'project'), root, { recursive: true });
    const observe = async (version: string) => {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
        import { readFileSync } from 'node:fs';
        import { pathToFileURL } from 'node:url';
        const { display } = await import(pathToFileURL(process.env.AUTOPATCH_CONSUMER).href);
        console.log(JSON.stringify(display(JSON.parse(readFileSync(process.env.AUTOPATCH_RESPONSE, 'utf8')))));
      `], { timeout: 10_000, env: { ...process.env, AUTOPATCH_CONSUMER: join(root, 'consumer.ts'),
        AUTOPATCH_RESPONSE: join(fixture, `${version}.response.json`) } });
      return JSON.parse(stdout) as unknown;
    };
    expect(await observe('acacia')).toEqual({ id: 'sub_example', label: 'Active', cancellationScheduled: false });
    let output = '';
    const code = await runCli(['--from', join(fixture, 'v1.json'), '--to', join(fixture, 'v2.json'),
      '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json'],
    { out: text => { output += text; }, err: () => {} });
    expect(code, output).toBe(0);
    const report = JSON.parse(output);
    expect(report).toMatchObject({ status: 'verified', written: true, diagnostics: [], llmAttempts: 0 });
    expect(report.changes).toHaveLength(3);
    expect(report.files).toHaveLength(1);
    const source = readFileSync(join(root, 'api.ts'), 'utf8');
    expect(source).not.toContain('current_period_end');
    expect(source).not.toContain('current_period_start');
    expect(source).toContain('cancel_at_period_end?: boolean | null');
    expect(await observe('basil')).toEqual({ id: 'sub_example', label: 'Active', cancellationScheduled: false });
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('blocks the real billing-period removal when a consumer still relies on it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopatch-stripe-blocked-'));
  try {
    cpSync(join(fixture, 'project'), root, { recursive: true });
    const consumer = 'import type { Subscription } from "./api.js";\nexport const renewal = (s: Subscription) => s.current_period_end;\n';
    writeFileSync(join(root, 'consumer.ts'), consumer);
    const before = readFileSync(join(root, 'api.ts'), 'utf8');
    let output = '';
    const code = await runCli(['--from', join(fixture, 'v1.json'), '--to', join(fixture, 'v2.json'),
      '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json'],
    { out: text => { output += text; }, err: () => {} });
    expect(code, output).toBe(1);
    const report = JSON.parse(output);
    expect(report).toMatchObject({ status: 'blocked', written: false, files: [], llmAttempts: 0 });
    expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2339, message: expect.stringContaining('current_period_end') })]));
    expect(readFileSync(join(root, 'api.ts'), 'utf8')).toBe(before);
    expect(readFileSync(join(root, 'consumer.ts'), 'utf8')).toBe(consumer);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
