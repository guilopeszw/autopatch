import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { runCli } from '../src/cli.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'autopatch-cli-'));
  roots.push(root);
  cpSync('tests/fixtures/target', root, { recursive: true });
  return { root, args: ['--from', resolve('tests/fixtures/openapi-v1.json'), '--to', resolve('tests/fixtures/openapi-v2.json'),
    '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--json'] };
}

test('previews a compiler-verified migration without writing the target project', async () => {
  const { root, args } = fixture();
  const before = readFileSync(join(root, 'api.ts'), 'utf8');
  let output = '';
  const exitCode = await runCli(args, { out: (text) => { output += text; }, err: () => {} });
  expect(exitCode).toBe(0);
  expect(JSON.parse(output)).toMatchObject({ status: 'verified', written: false, diagnostics: [], llmAttempts: 0 });
  expect(JSON.parse(output).files).toHaveLength(2);
  expect(readFileSync(join(root, 'api.ts'), 'utf8')).toBe(before);
});

test('writes both SDK and consumer files only with --write', async () => {
  const { root, args } = fixture();
  let output = '';
  expect(await runCli([...args, '--write'], { out: (text) => { output += text; }, err: () => {} })).toBe(0);
  expect(JSON.parse(output).written).toBe(true);
  expect(readFileSync(join(root, 'api.ts'), 'utf8')).toContain('function registerUser');
  expect(readFileSync(join(root, 'consumer.ts'), 'utf8')).toContain('displayName: name');
});

test('offers a CI check exit code without writing and rejects conflicting flags', async () => {
  const { root, args } = fixture();
  const before = readFileSync(join(root, 'api.ts'), 'utf8');
  const silent = { out: () => {}, err: () => {} };
  expect(await runCli([...args, '--check'], silent)).toBe(1);
  expect(await runCli([...args, '--write', '--dry-run'], silent)).toBe(2);
  expect(readFileSync(join(root, 'api.ts'), 'utf8')).toBe(before);
});
