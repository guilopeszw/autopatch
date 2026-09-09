import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { runMonitorCli } from '../src/automation/monitor.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'autopatch-monitor-'))); roots.push(root);
  const artifacts = mkdtempSync(join(tmpdir(), 'autopatch-monitor-artifacts-')); roots.push(artifacts);
  cpSync('tests/fixtures/target', root, { recursive: true });
  const before = JSON.parse(readFileSync('tests/fixtures/openapi-v1.json', 'utf8'));
  // This monitor watches schema properties; operation discovery remains explicit.
  before.paths = {};
  const after = structuredClone(before);
  after.components.schemas.CreateUser.properties.name = { type: 'string', enum: ['Ada', 'Grace'] };
  writeFileSync(join(root, 'baseline.json'), JSON.stringify(before));
  writeFileSync(join(root, 'target.json'), JSON.stringify(before));
  writeFileSync(join(root, 'autopatch.json'), JSON.stringify({ from: 'baseline.json', to: 'target.json', project: 'tsconfig.json', bindings: 'bindings.json' }));
  writeFileSync(join(root, 'monitor.json'), JSON.stringify({ id: 'billing', migration: 'autopatch.json',
    source: { repository: 'example/spec', ref: 'main', path: 'openapi.json' },
    schemas: { CreateUser: ['name'] }, verify: [[process.execPath, '-e', 'process.exit(0)']] }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-b', 'main'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: seed project');
  const requests: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = String(input); requests.push(url);
    return Response.json(url.startsWith('https://api.github.com/') ? { sha: 'a'.repeat(40) } : after);
  };
  const run = async (name: string, prepare = false, transport = fetcher) => {
    const output = join(artifacts, name);
    const code = await runMonitorCli(['--root', root, '--config', 'monitor.json', '--output', output, ...(prepare ? ['--prepare'] : [])], { out: () => {}, err: () => {} }, transport);
    return { code, output, manifest: JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')) };
  };
  return { root, git, before, after, requests, run };
}

test('pins an upstream revision and previews a typed patch without modifying the checkout', async () => {
  const f = fixture();
  const { code, output, manifest } = await f.run('preview');
  expect(code).toBe(0);
  expect(manifest).toMatchObject({ status: 'ready', prepared: false, source: { revision: 'a'.repeat(40) } });
  expect(f.requests).toEqual(['https://api.github.com/repos/example/spec/commits/main', `https://raw.githubusercontent.com/example/spec/${'a'.repeat(40)}/openapi.json`]);
  expect(readFileSync(join(output, 'review.html'), 'utf8')).toContain('Verified migration plan');
  expect(JSON.parse(readFileSync(join(output, 'result.json'), 'utf8')).files).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: join(f.root, 'api.ts'), after: expect.stringContaining('"Ada" | "Grace"') }),
  ]));
  expect(f.git('status', '--porcelain')).toBe('');
});

test('prepares checked files and baselines once, then reports unchanged after the migration lands', async () => {
  const f = fixture();
  writeFileSync(join(f.root, 'verify.mjs'), "import assert from 'node:assert/strict'; import { createUser } from './api.ts'; assert.equal(createUser({ name: 'Ada' }), 'Ada');\n");
  const config = JSON.parse(readFileSync(join(f.root, 'monitor.json'), 'utf8'));
  config.verify = [[process.execPath, 'verify.mjs']];
  writeFileSync(join(f.root, 'monitor.json'), JSON.stringify(config));
  f.git('add', '.'); f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: configure application check');
  const first = await f.run('prepared', true);
  expect(first.code).toBe(0);
  expect(first.manifest).toMatchObject({ status: 'ready', prepared: true, files: ['api.ts', 'baseline.json', 'target.json'] });
  expect(f.git('diff', '--cached', '--name-only').trim().split('\n')).toEqual(['api.ts', 'baseline.json', 'target.json']);
  expect(readFileSync(join(f.root, 'api.ts'), 'utf8')).toContain('"Ada" | "Grace"');
  expect(readFileSync(join(f.root, 'baseline.json'), 'utf8')).toBe(readFileSync(join(f.root, 'target.json'), 'utf8'));
  expect(readFileSync(join(first.output, 'checks.json'), 'utf8')).toContain('passed');
  f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fix: apply reviewed migration');
  const second = await f.run('unchanged', true);
  expect(second.code).toBe(0);
  expect(second.manifest).toMatchObject({ status: 'unchanged', prepared: false, files: [] });
  expect(f.git('status', '--porcelain')).toBe('');
});

test('restores source and baselines when an approved application check fails', async () => {
  const f = fixture();
  const config = JSON.parse(readFileSync(join(f.root, 'monitor.json'), 'utf8'));
  config.verify = [[process.execPath, '-e', 'process.exit(1)']];
  writeFileSync(join(f.root, 'monitor.json'), JSON.stringify(config));
  f.git('add', '.'); f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: require failing application check');
  const { code, manifest, output } = await f.run('failed-check', true);
  expect(code).toBe(1);
  expect(manifest).toMatchObject({ status: 'blocked', prepared: false, files: [] });
  expect(readFileSync(join(output, 'checks.json'), 'utf8')).toContain('failed');
  expect(f.git('status', '--porcelain')).toBe('');
});

test('blocks unsupported contract changes without running application checks or modifying source', async () => {
  const f = fixture();
  f.after.components.schemas.CreateUser.properties.name = { type: 'object', properties: {} };
  const { code, manifest, output } = await f.run('unsupported', true);
  expect(code).toBe(1);
  expect(manifest).toMatchObject({ status: 'blocked', prepared: false, files: [] });
  expect(JSON.parse(readFileSync(join(output, 'result.json'), 'utf8')).files).toEqual([]);
  expect(f.git('status', '--porcelain')).toBe('');
});

test('restores every recoverable file when a failed application check deletes a patched file', async () => {
  const f = fixture();
  const baseline = readFileSync(join(f.root, 'baseline.json'), 'utf8');
  const target = readFileSync(join(f.root, 'target.json'), 'utf8');
  const config = JSON.parse(readFileSync(join(f.root, 'monitor.json'), 'utf8'));
  config.verify = [[process.execPath, '-e', "require('node:fs').unlinkSync('api.ts'); process.exit(1)"]];
  writeFileSync(join(f.root, 'monitor.json'), JSON.stringify(config));
  f.git('add', '.'); f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: delete a patched file during checks');
  const { code, manifest } = await f.run('deleted-file', true);
  expect(code).toBe(1);
  expect(manifest).toMatchObject({ status: 'blocked', prepared: false, files: [] });
  expect(readFileSync(join(f.root, 'baseline.json'), 'utf8')).toBe(baseline);
  expect(readFileSync(join(f.root, 'target.json'), 'utf8')).toBe(target);
  expect(f.git('status', '--porcelain').trim()).toBe('D api.ts');
});

test('removes its staged replacements after a failed check without overwriting concurrent source edits', async () => {
  const f = fixture();
  const config = JSON.parse(readFileSync(join(f.root, 'monitor.json'), 'utf8'));
  config.verify = [[process.execPath, '-e', "require('node:child_process').execFileSync('git', ['add', 'api.ts']); require('node:fs').writeFileSync('api.ts', '// concurrent edit\\n'); process.exit(1)"]];
  writeFileSync(join(f.root, 'monitor.json'), JSON.stringify(config));
  f.git('add', '.'); f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: stage patch before failing checks');
  const { code } = await f.run('staged-failure', true);
  expect(code).toBe(1);
  expect(f.git('diff', '--cached', '--name-only')).toBe('');
  expect(readFileSync(join(f.root, 'api.ts'), 'utf8')).toBe('// concurrent edit\n');
  expect(f.git('diff', '--name-only').trim()).toBe('api.ts');
});

test('retries a transient provider failure and reads an immutable YAML specification', async () => {
  const f = fixture();
  const config = JSON.parse(readFileSync(join(f.root, 'monitor.json'), 'utf8'));
  config.source.path = 'openapi.yaml';
  writeFileSync(join(f.root, 'monitor.json'), JSON.stringify(config));
  f.git('add', '.'); f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: monitor YAML');
  let calls = 0;
  const transport: typeof fetch = async input => {
    calls++;
    if (calls === 1) return new Response('retry', { status: 503 });
    if (String(input).startsWith('https://api.github.com/')) return Response.json({ sha: 'b'.repeat(40) });
    return new Response('openapi: 3.0.0\ninfo: {title: Billing, version: "2"}\npaths: {}\ncomponents:\n  schemas:\n    CreateUser:\n      type: object\n      required: [name]\n      properties:\n        name: {type: string, enum: [Ada, Grace]}\n');
  };
  const { code, manifest } = await f.run('yaml', false, transport);
  expect(code).toBe(0);
  expect(manifest).toMatchObject({ status: 'ready', source: { revision: 'b'.repeat(40) } });
  expect(calls).toBe(3);
  expect(f.git('status', '--porcelain')).toBe('');
});

test('reports a removed monitored schema as a manual decision instead of a fetch failure', async () => {
  const f = fixture();
  delete f.after.components.schemas.CreateUser;
  const { code, manifest } = await f.run('removed-schema', true);
  expect(code).toBe(1);
  expect(manifest).toMatchObject({ status: 'blocked', prepared: false, files: [], issues: [expect.stringContaining('Monitored schema is missing')] });
  expect(f.git('status', '--porcelain')).toBe('');
});
