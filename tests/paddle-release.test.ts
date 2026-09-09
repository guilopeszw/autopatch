import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { runCli } from '../src/cli.js';

const execute = promisify(execFile);

test('migrates published Paddle currencies in an Orval client while preserving subscription HTTP observations', async () => {
  const fixture = resolve('tests/fixtures/paddle-release');
  const provenance = JSON.parse(readFileSync(join(fixture, 'provenance.json'), 'utf8')) as { files: Record<string, string> };
  for (const [path, digest] of Object.entries(provenance.files)) {
    expect(createHash('sha256').update(readFileSync(join(fixture, path))).digest('hex'), path).toBe(digest);
  }
  const root = mkdtempSync(join(tmpdir(), 'autopatch-paddle-release-'));
  const requests: Array<{ method: string | undefined; url: string | undefined }> = [];
  let currency = 'USD';
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { id: 'sub_example', currency_code: currency } }));
  });
  try {
    cpSync(join(fixture, 'project'), root, { recursive: true });
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected loopback TCP server');
    // Only the checked-in, reviewed fixture executes; redirect its relative URL
    // to loopback and reject every other destination. No provider credentials.
    const observe = async () => {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
        import { pathToFileURL } from 'node:url';
        const nativeFetch = globalThis.fetch;
        globalThis.fetch = (input, options) => {
          if (String(input) !== '/subscriptions/sub_example') throw new Error('Unexpected fixture URL');
          return nativeFetch(process.env.AUTOPATCH_ORIGIN + input, options);
        };
        const { observe } = await import(pathToFileURL(process.env.AUTOPATCH_CONSUMER).href);
        console.log(JSON.stringify(await observe()));
      `], { timeout: 10_000, env: { ...process.env, AUTOPATCH_ORIGIN: `http://127.0.0.1:${address.port}`, AUTOPATCH_CONSUMER: join(root, 'consumer.ts') } });
      return JSON.parse(stdout) as unknown;
    };
    expect(await observe()).toEqual({ status: 200, subscription: 'sub_example', currency: 'USD' });
    const client = readFileSync(join(root, 'generated/client.ts'), 'utf8');
    let output = '';
    expect(await runCli(['--from', join(fixture, 'v1.json'), '--to', join(fixture, 'v2.json'),
      '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json'],
    { out: text => { output += text; }, err: () => {} }), output).toBe(0);
    const result = JSON.parse(output);
    expect(result).toMatchObject({ status: 'verified', written: true, diagnostics: [], llmAttempts: 0 });
    expect(result.changes).toHaveLength(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe(join(root, 'generated/models/subscription.ts'));
    expect(result.files[0].after).toContain('"CLP"');
    expect(result.files[0].after).toContain('"PEN"');
    expect(readFileSync(join(root, 'generated/client.ts'), 'utf8')).toBe(client);
    expect(await observe()).toEqual({ status: 200, subscription: 'sub_example', currency: 'USD' });
    currency = 'CLP';
    expect(await observe()).toEqual({ status: 200, subscription: 'sub_example', currency: 'CLP' });
    currency = 'PEN';
    expect(await observe()).toEqual({ status: 200, subscription: 'sub_example', currency: 'PEN' });
    expect(requests).toEqual(Array.from({ length: 4 }, () => ({ method: 'GET', url: '/subscriptions/sub_example' })));
  } finally {
    await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('blocks the Paddle release when an exhaustive currency policy has no CLP or PEN decision', async () => {
  const fixture = resolve('tests/fixtures/paddle-release');
  const root = mkdtempSync(join(tmpdir(), 'autopatch-paddle-policy-'));
  try {
    cpSync(join(fixture, 'project'), root, { recursive: true });
    cpSync(join(fixture, 'blocked-consumer.ts'), join(root, 'consumer.ts'));
    const model = readFileSync(join(root, 'generated/models/subscription.ts'), 'utf8');
    const consumer = readFileSync(join(root, 'consumer.ts'), 'utf8');
    let output = '';
    expect(await runCli(['--from', join(fixture, 'v1.json'), '--to', join(fixture, 'v2.json'),
      '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json'],
    { out: text => { output += text; }, err: () => {} }), output).toBe(1);
    const result = JSON.parse(output);
    expect(result).toMatchObject({ status: 'blocked', written: false, files: [], llmAttempts: 0 });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2739, message: expect.stringContaining('CLP, PEN') })]));
    expect(readFileSync(join(root, 'generated/models/subscription.ts'), 'utf8')).toBe(model);
    expect(readFileSync(join(root, 'consumer.ts'), 'utf8')).toBe(consumer);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
