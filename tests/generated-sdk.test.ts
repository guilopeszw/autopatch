import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { runCli } from '../src/cli.js';

const execute = promisify(execFile);

test('migrates a pinned Orval SDK through the CLI while preserving real HTTP observations', async () => {
  const fixture = resolve('tests/fixtures/orval');
  const provenance = JSON.parse(readFileSync(join(fixture, 'provenance.json'), 'utf8')) as { files: Record<string, string> };
  for (const [path, digest] of Object.entries(provenance.files)) {
    expect(createHash('sha256').update(readFileSync(join(fixture, path))).digest('hex'), path).toBe(digest);
  }
  const root = mkdtempSync(join(tmpdir(), 'autopatch-orval-'));
  const requests: Array<{ method: string | undefined; url: string | undefined }> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify([{ id: 1, name: 'Ada', type: 'cat' }]));
  });
  try {
    cpSync(fixture, root, { recursive: true });
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP server');
    const origin = `http://127.0.0.1:${address.port}`;
    // Execute only this reviewed fixture. Forward its hard-coded localhost:3000
    // transport to an ephemeral loopback port; no external HTTP or provider mock.
    const observe = async () => {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
        import { pathToFileURL } from 'node:url';
        const nativeFetch = globalThis.fetch;
        globalThis.fetch = (input, options) => {
          const url = new URL(input);
          if (url.origin !== 'http://localhost:3000') throw new Error('Unexpected fixture origin');
          return nativeFetch(process.env.AUTOPATCH_FIXTURE_ORIGIN + url.pathname + url.search, options);
        };
        const { observe } = await import(pathToFileURL(process.env.AUTOPATCH_FIXTURE_CONSUMER).href);
        console.log(JSON.stringify(await observe()));
      `], { cwd: process.cwd(), timeout: 10_000, env: { ...process.env, NODE_ENV: 'test',
        AUTOPATCH_FIXTURE_ORIGIN: origin, AUTOPATCH_FIXTURE_CONSUMER: join(root, 'consumer.ts') } });
      return JSON.parse(stdout) as unknown;
    };
    expect(await observe()).toEqual({ status: 200, names: ['Ada'] });
    const args = ['--from', join(root, 'v1.json'), '--to', join(root, 'v2.json'),
      '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--json'];
    const original = readFileSync(join(root, 'consumer.ts'), 'utf8');
    let output = '';
    const preview = await runCli(args, { out: text => { output += text; }, err: () => {} });
    expect(preview, output).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ status: 'verified', written: false, diagnostics: [], llmAttempts: 0 });
    expect(readFileSync(join(root, 'consumer.ts'), 'utf8')).toBe(original);
    output = '';
    const write = await runCli([...args, '--write'], { out: text => { output += text; }, err: () => {} });
    expect(write, output).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ status: 'verified', written: true, diagnostics: [], llmAttempts: 0 });
    expect(JSON.parse(output).files, output).toHaveLength(2);
    expect(readFileSync(join(root, 'upstream/app/gen/pets/pets.ts'), 'utf8')).toContain('export const fetchPets = async');
    // The language service preserves the barrel's public alias, so its consumer
    // needs no edit while still calling the renamed SDK declaration.
    expect(readFileSync(join(root, 'barrel.ts'), 'utf8')).toContain('fetchPets as listPets');
    expect(readFileSync(join(root, 'consumer.ts'), 'utf8')).toBe(original);
    expect(await observe()).toEqual({ status: 200, names: ['Ada'] });
    expect(requests).toEqual([{ method: 'GET', url: '/pets?limit=2' }, { method: 'GET', url: '/pets?limit=2' }]);
  } finally {
    await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); });
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
