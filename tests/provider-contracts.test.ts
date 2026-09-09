import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Project } from 'ts-morph';
import { expect, test } from 'vitest';
import { runCli } from '../src/cli.js';

const execute = promisify(execFile);

for (const [provider, property, type, observation] of [
  ['brex', 'phone_number', 'string | null', 'Recife'],
  ['ramp', 'employee_id', 'string', 'Ada'],
] as const) {
  test(`aligns an incomplete local ${provider} adapter with its published target contract`, async () => {
    const source = resolve(`tests/fixtures/providers/${provider}`);
    const provenance = JSON.parse(readFileSync(join(source, 'provenance.json'), 'utf8')) as { files: Record<string, string> };
    for (const [path, digest] of Object.entries(provenance.files)) {
      expect(createHash('sha256').update(readFileSync(join(source, path))).digest('hex')).toBe(digest);
    }
    const root = mkdtempSync(join(tmpdir(), `autopatch-${provider}-`));
    try {
      cpSync(join(source, 'project'), root, { recursive: true });
      // Only execute these reviewed, repository-owned adapters. No remote API,
      // financial transaction, generated patch program, or model is invoked.
      const observe = async () => (await execute(process.execPath, [join(root, 'consumer.ts')], { timeout: 5000 })).stdout.trim();
      expect(await observe()).toBe(observation);
      let output = '';
      const code = await runCli(['--from', join(source, 'baseline.json'), '--to', join(source, 'target.json'),
        '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json', '--report', join(root, 'review.html')],
      { out: text => { output += text; }, err: () => {} });
      expect(code, output).toBe(0);
      const report = JSON.parse(output);
      expect(report).toMatchObject({ status: 'verified', written: true, diagnostics: [], llmAttempts: 0 });
      expect(report.changes).toEqual([expect.objectContaining({ kind: 'property-updated', property })]);
      expect(readFileSync(join(root, 'api.ts'), 'utf8')).toContain(`"${property}"?: ${type}`);
      expect(await observe()).toBe(observation);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test(`blocks a ${provider} consumer that assumes the published string field is numeric`, async () => {
    const source = resolve(`tests/fixtures/providers/${provider}`);
    const root = mkdtempSync(join(tmpdir(), `autopatch-${provider}-blocked-`));
    try {
      cpSync(join(source, 'project'), root, { recursive: true });
      const baseline = JSON.parse(readFileSync(join(source, 'baseline.json'), 'utf8'));
      const component = provider === 'brex' ? 'Address' : 'ApiTransactionCardHolder';
      baseline.components.schemas[component].properties[property] = { type: 'number' };
      writeFileSync(join(root, 'baseline.json'), JSON.stringify(baseline));
      const project = new Project({ tsConfigFilePath: join(root, 'tsconfig.json') });
      const api = project.getSourceFileOrThrow(join(root, 'api.ts'));
      api.getInterfaceOrThrow(component).addProperty({ name: property, type: 'number', hasQuestionToken: true });
      const before = api.getFullText();
      writeFileSync(join(root, 'api.ts'), before);
      const consumer = `import type { ${component} } from './api.js';\nexport const legacy = (value: ${component}) => (value.${property} ?? 0).toFixed(0);\n`;
      writeFileSync(join(root, 'consumer.ts'), consumer);
      let output = '';
      expect(await runCli(['--from', join(root, 'baseline.json'), '--to', join(source, 'target.json'),
        '--project', join(root, 'tsconfig.json'), '--bindings', join(root, 'bindings.json'), '--write', '--json'],
      { out: text => { output += text; }, err: () => {} }), output).toBe(1);
      const report = JSON.parse(output);
      expect(report).toMatchObject({ status: 'blocked', written: false, files: [], llmAttempts: 0 });
      expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 2339 })]));
      expect(readFileSync(join(root, 'api.ts'), 'utf8')).toBe(before);
      expect(readFileSync(join(root, 'consumer.ts'), 'utf8')).toBe(consumer);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
