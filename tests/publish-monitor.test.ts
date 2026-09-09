import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { runPublishCli } from '../src/automation/publish.js';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'autopatch-publish-'))); roots.push(root);
  const remote = mkdtempSync(join(tmpdir(), 'autopatch-remote-')); roots.push(remote);
  const output = mkdtempSync(join(tmpdir(), 'autopatch-publish-report-')); roots.push(output);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main'); git('init', '--bare', remote);
  writeFileSync(join(root, 'api.ts'), 'export const version = 1;\n');
  git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'test: seed app');
  git('remote', 'add', 'origin', 'https://github.com/example/app.git');
  // Real Git transport to a local bare repository; only GitHub HTTP is substituted.
  git('config', `url.${remote}.insteadOf`, 'https://github.com/example/app.git');
  git('push', 'origin', 'main');
  const head = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(root, 'api.ts'), 'export const version = 2;\n'); git('add', 'api.ts');
  const eventKey = 'a'.repeat(64);
  const manifest = { id: 'billing', status: 'ready', prepared: true, files: ['api.ts'], head, eventKey,
    patchSha256: createHash('sha256').update(git('diff', '--cached', '--binary', '--full-index')).digest('hex') };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(output, 'body.md'), 'Verified patch. Human approval required.');
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const pulls: { html_url: string; state: string }[] = [];
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    requests.push({ method, path: url.pathname, body });
    if (url.pathname.endsWith('/pulls') && method === 'GET') return Response.json(pulls);
    if (url.pathname.endsWith('/pulls') && method === 'POST') { const pr = { html_url: 'https://github.com/example/app/pull/1', state: 'open' }; pulls.push(pr); return Response.json(pr); }
    if (url.pathname.endsWith('/issues')) return Response.json([]);
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  };
  vi.stubEnv('GH_TOKEN', 'test-token');
  const run = (transport = fetcher, extra: string[] = []) => runPublishCli(['--root', root, '--output', output, '--repository', 'example/app', '--base', 'main', ...extra], { out: () => {}, err: () => {} }, transport);
  return { root, remote, output, git, head, manifest, requests, pulls, run, fetcher };
}

test('publishes a draft PR once and never merges or rewrites its branch on retry', async () => {
  const f = fixture();
  expect(await f.run()).toBe(0);
  expect(f.requests.filter(r => r.method === 'POST' && r.path.endsWith('/pulls'))).toEqual([
    expect.objectContaining({ body: expect.objectContaining({ draft: true, base: 'main', title: 'fix: update billing API contract' }) }),
  ]);
  const branch = f.git('branch', '--show-current').trim();
  const firstHead = f.git('rev-parse', 'HEAD').trim();
  expect(f.git('ls-remote', '--heads', 'origin', branch)).toContain(firstHead);
  expect(await f.run()).toBe(0);
  expect(f.git('rev-parse', 'HEAD').trim()).toBe(firstHead);
  expect(f.requests.filter(r => r.method === 'POST')).toHaveLength(1);
  expect(f.requests.some(r => r.path.endsWith('/merge'))).toBe(false);
});

test('creates one actionable monitor notice and suppresses identical failed retries', async () => {
  const f = fixture();
  writeFileSync(join(f.output, 'manifest.json'), JSON.stringify({ id: 'billing', status: 'failed', prepared: false, files: [], issues: ['Provider request failed (HTTP 503)'] }));
  const issues: Record<string, unknown>[] = [];
  const mutations: string[] = [];
  const transport: typeof fetch = async (input, options) => {
    const path = new URL(String(input)).pathname;
    const method = options?.method ?? 'GET';
    if (path.endsWith('/issues') && method === 'GET') return Response.json(issues);
    if (path.endsWith('/issues') && method === 'POST') {
      const body = JSON.parse(String(options?.body)); mutations.push(method);
      expect(body.title).toBe('AutoPatch: billing — monitor failed');
      expect(body.body).toContain('Provider request failed (HTTP 503)');
      const issue = { number: 1, state: 'open', user: { login: 'github-actions[bot]' }, ...body }; issues.push(issue);
      return Response.json(issue);
    }
    throw new Error(`Unexpected mutation ${method} ${path}`);
  };
  expect(await f.run(transport)).toBe(0);
  expect(await f.run(transport)).toBe(0);
  expect(mutations).toEqual(['POST']);
  expect(f.git('rev-parse', 'HEAD').trim()).toBe(f.head);
  expect(f.git('ls-remote', '--heads', 'origin').trim().split('\n')).toHaveLength(1);
});

test('recovers a pushed branch after PR creation fails without making a second commit', async () => {
  const f = fixture();
  const failCreate: typeof fetch = (input, options) => options?.method === 'POST' && new URL(String(input)).pathname.endsWith('/pulls')
    ? Promise.resolve(new Response('temporary failure', { status: 503 })) : f.fetcher(input, options);
  expect(await f.run(failCreate)).toBe(2);
  const pushed = f.git('rev-parse', 'HEAD').trim();
  expect(f.git('ls-remote', '--heads', 'origin').trim().split('\n')).toHaveLength(2);
  expect(await f.run()).toBe(0);
  expect(f.git('rev-parse', 'HEAD').trim()).toBe(pushed);
  expect(f.pulls).toHaveLength(1);
});

test('refuses altered staged files before publishing a branch', async () => {
  const f = fixture();
  writeFileSync(join(f.root, 'api.ts'), 'export const version = 999;\n'); f.git('add', 'api.ts');
  expect(await f.run()).toBe(2);
  expect(f.requests.some(r => r.method !== 'GET')).toBe(false);
  expect(f.git('rev-parse', 'HEAD').trim()).toBe(f.head);
  expect(f.git('ls-remote', '--heads', 'origin').trim().split('\n')).toHaveLength(1);
});

test('recovers an orphan draft branch after unrelated changes land on the default branch', async () => {
  const f = fixture();
  const failCreate: typeof fetch = (input, options) => options?.method === 'POST' && new URL(String(input)).pathname.endsWith('/pulls')
    ? Promise.resolve(new Response('temporary failure', { status: 503 })) : f.fetcher(input, options);
  expect(await f.run(failCreate)).toBe(2);
  const branch = f.git('branch', '--show-current').trim();
  const pushed = f.git('rev-parse', 'HEAD').trim();
  f.git('switch', 'main');
  writeFileSync(join(f.root, 'README.md'), 'An unrelated application update.\n');
  f.git('add', '.'); f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'docs: update application guide');
  f.git('push', 'origin', 'main');
  const newHead = f.git('rev-parse', 'HEAD').trim();
  writeFileSync(join(f.root, 'api.ts'), 'export const version = 2;\n'); f.git('add', 'api.ts');
  writeFileSync(join(f.output, 'manifest.json'), JSON.stringify({ ...f.manifest, head: newHead }));
  expect(await f.run()).toBe(0);
  expect(f.pulls).toHaveLength(1);
  expect(f.git('ls-remote', '--heads', 'origin', branch)).toContain(pushed);
  expect(f.git('rev-parse', 'HEAD').trim()).toBe(newHead);
});

test('deduplicates and closes notices authored by a configured custom publisher', async () => {
  const f = fixture();
  const manifest = { id: 'billing', status: 'blocked', prepared: false, files: [], issues: ['Unsupported contract change'] };
  writeFileSync(join(f.output, 'manifest.json'), JSON.stringify(manifest));
  const issues: Record<string, unknown>[] = [];
  const mutations: string[] = [];
  const transport: typeof fetch = async (input, options) => {
    const method = options?.method ?? 'GET';
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/issues') && method === 'GET') return Response.json(issues);
    const body = JSON.parse(String(options?.body));
    if (path.endsWith('/issues') && method === 'POST') {
      mutations.push(method);
      const issue = { number: 1, state: 'open', user: { login: 'billing-maintainer[bot]' }, ...body };
      issues.push(issue); return Response.json(issue);
    }
    if (path.endsWith('/issues/1') && method === 'PATCH') {
      mutations.push(method); Object.assign(issues[0]!, body); return Response.json(issues[0]);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  const args = ['--issue-author', 'billing-maintainer[bot]'];
  expect(await f.run(transport, args)).toBe(0);
  expect(await f.run(transport, args)).toBe(0);
  expect(mutations).toEqual(['POST']);
  writeFileSync(join(f.output, 'manifest.json'), JSON.stringify({ ...manifest, status: 'unchanged', issues: [] }));
  expect(await f.run(transport, args)).toBe(0);
  expect(mutations).toEqual(['POST', 'PATCH']);
  expect(issues[0]).toMatchObject({ state: 'closed' });
});
