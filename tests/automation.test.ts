import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execute = promisify(execFile);
const entrypoint = resolve('scripts/prepare-migration-pr.ts');
const tsxLoader = createRequire(resolve('package.json')).resolve('tsx');

test('prepares only verified tracked edits and advances the baseline in a disposable Git checkout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopatch-pr-'));
  const artifacts = mkdtempSync(join(tmpdir(), 'autopatch-pr-artifacts-'));
  const git = (...args: string[]) => execute('git', args, { cwd: root });
  try {
    cpSync('tests/fixtures/target', root, { recursive: true });
    cpSync('tests/fixtures/openapi-v1.json', join(root, 'baseline.json'));
    cpSync('tests/fixtures/openapi-v2.json', join(root, 'target.json'));
    writeFileSync(join(root, 'autopatch.json'), JSON.stringify({ from: 'baseline.json', to: 'target.json', project: 'tsconfig.json', bindings: 'bindings.json' }));
    await git('init', '-b', 'main');
    await git('add', '.');
    await git('-c', 'user.name=AutoPatch test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: seed target');
    const output = join(artifacts, 'first');
    await execute(process.execPath, ['--import', tsxLoader, entrypoint,
      '--config', 'autopatch.json', '--output', output], { cwd: root, timeout: 25_000 });
    expect(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))).toMatchObject({
      status: 'ready', files: ['api.ts', 'baseline.json', 'bindings.json', 'consumer.ts'],
    });
    expect(readFileSync(join(root, 'baseline.json'), 'utf8')).toBe(readFileSync(join(root, 'target.json'), 'utf8'));
    expect((await git('diff', '--cached', '--name-only')).stdout.trim().split('\n')).toEqual(['api.ts', 'baseline.json', 'bindings.json', 'consumer.ts']);
    expect(JSON.parse(readFileSync(join(root, 'bindings.json'), 'utf8')).operations).toEqual({ registerUser: { file: 'api.ts', export: 'registerUser' } });
    expect(readFileSync(join(output, 'review.html'), 'utf8')).toContain('Verified migration plan');
    expect(readFileSync(join(output, 'body.md'), 'utf8')).toContain('zero compiler errors');
    // After the generated commit lands, the same target must not generate a new PR.
    await git('-c', 'user.name=AutoPatch test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fix: migrate API contract');
    const second = join(artifacts, 'second');
    await execute(process.execPath, ['--import', tsxLoader, entrypoint,
      '--config', 'autopatch.json', '--output', second], { cwd: root, timeout: 25_000 });
    expect(JSON.parse(readFileSync(join(second, 'manifest.json'), 'utf8'))).toMatchObject({ status: 'noop', files: [] });
    expect((await git('status', '--porcelain')).stdout).toBe('');
    const nextTarget = JSON.parse(readFileSync(join(root, 'target.json'), 'utf8'));
    nextTarget.paths['/users'].post.operationId = 'enrollUser';
    writeFileSync(join(root, 'target.json'), JSON.stringify(nextTarget));
    await git('add', 'target.json');
    await git('-c', 'user.name=AutoPatch test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: publish next target');
    await execute(process.execPath, ['--import', tsxLoader, entrypoint,
      '--config', 'autopatch.json', '--output', join(artifacts, 'third')], { cwd: root, timeout: 25_000 });
    expect(readFileSync(join(root, 'api.ts'), 'utf8')).toContain('function enrollUser');
    expect(JSON.parse(readFileSync(join(root, 'bindings.json'), 'utf8')).operations).toEqual({ enrollUser: { file: 'api.ts', export: 'enrollUser' } });
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(artifacts, { recursive: true, force: true }); }
}, 40_000);

test('exports blocked findings without staging or changing the schema baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopatch-pr-blocked-'));
  const artifacts = mkdtempSync(join(tmpdir(), 'autopatch-pr-artifacts-'));
  const git = (...args: string[]) => execute('git', args, { cwd: root });
  try {
    cpSync('tests/fixtures/live', root, { recursive: true });
    writeFileSync(join(root, 'autopatch.json'), JSON.stringify({ from: 'v1.json', to: 'v2.json', project: 'tsconfig.json', bindings: 'bindings.json' }));
    await git('init', '-b', 'main'); await git('add', '.');
    await git('-c', 'user.name=AutoPatch test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: seed incompatible target');
    const before = readFileSync(join(root, 'v1.json'), 'utf8');
    const output = join(artifacts, 'blocked');
    await expect(execute(process.execPath, ['--import', tsxLoader, entrypoint,
      '--config', 'autopatch.json', '--output', output], { cwd: root, timeout: 25_000 })).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))).toEqual({ status: 'blocked', files: [] });
    expect(readFileSync(join(output, 'review.html'), 'utf8')).toContain('Migration blocked');
    expect(readFileSync(join(root, 'v1.json'), 'utf8')).toBe(before);
    expect((await git('status', '--porcelain')).stdout).toBe('');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(artifacts, { recursive: true, force: true }); }
}, 30_000);

test('refuses an untracked source patch before changing any file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autopatch-pr-untracked-'));
  const artifacts = mkdtempSync(join(tmpdir(), 'autopatch-pr-artifacts-'));
  const git = (...args: string[]) => execute('git', args, { cwd: root });
  try {
    cpSync('tests/fixtures/target', root, { recursive: true });
    cpSync('tests/fixtures/openapi-v1.json', join(root, 'baseline.json'));
    cpSync('tests/fixtures/openapi-v2.json', join(root, 'target.json'));
    writeFileSync(join(root, 'autopatch.json'), JSON.stringify({ from: 'baseline.json', to: 'target.json', project: 'tsconfig.json', bindings: 'bindings.json' }));
    await git('init', '-b', 'main'); await git('add', '.'); await git('rm', '--cached', 'consumer.ts');
    await git('-c', 'user.name=AutoPatch test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: seed tracked subset');
    const before = readFileSync(join(root, 'api.ts'), 'utf8');
    await expect(execute(process.execPath, ['--import', tsxLoader, entrypoint,
      '--config', 'autopatch.json', '--output', join(artifacts, 'untracked')], { cwd: root, timeout: 25_000 })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('untracked source') });
    expect(readFileSync(join(root, 'api.ts'), 'utf8')).toBe(before);
    expect((await git('diff', '--cached', '--name-only')).stdout).toBe('');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(artifacts, { recursive: true, force: true }); }
}, 30_000);
