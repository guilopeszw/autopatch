import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterEach, expect, test } from 'vitest';
import { writeVerifiedPatch } from '../src/core/runner/patch-writer.js';
import type { MigrationResult } from '../src/core/runner/migration.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'autopatch-writer-'));
  directories.push(root);
  const file = join(root, 'input.ts');
  const before = 'export const count: number = 1;';
  writeFileSync(file, before);
  const project = new Project({ compilerOptions: { strict: true, types: [] } });
  project.addSourceFileAtPath(file);
  const result: MigrationResult = { status: 'verified', changes: [], diagnostics: [], issues: [], llmAttempts: 0,
    files: [{ path: file, before, after: 'export const count: number = 2;' }] };
  return { root, file, before, project, result };
}

test('revalidates the patch immediately before replacing the on-disk file', () => {
  const { root, file, project, result } = setup();
  writeVerifiedPatch(project, result, root);
  expect(readFileSync(file, 'utf8')).toBe('export const count: number = 2;');
});

test('rejects a stale preimage and preserves the user edit', () => {
  const { root, file, project, result } = setup();
  writeFileSync(file, 'export const count = 99;');
  expect(() => writeVerifiedPatch(project, result, root)).toThrow(/stale/i);
  expect(readFileSync(file, 'utf8')).toBe('export const count = 99;');
});

test('rejects compiler-invalid contents even when the report claims verification', () => {
  const { root, file, before, project, result } = setup();
  result.files[0]!.after = 'export const count: number = "bad";';
  expect(() => writeVerifiedPatch(project, result, root)).toThrow(/compiler validation/i);
  expect(readFileSync(file, 'utf8')).toBe(before);
});
