import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterEach, expect, test, vi } from 'vitest';
import { writeVerifiedPatch } from '../src/core/runner/patch-writer.js';
import type { MigrationResult } from '../src/core/runner/migration.js';

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
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


test.each([false, true])('recovers a partial write while preserving concurrent user edits: %s', (concurrentEdit) => {
  const { root, file, before, project, result } = setup();
  const second = join(root, 'second.ts');
  writeFileSync(second, 'export const second = 1;');
  project.addSourceFileAtPath(second);
  result.files.push({ path: second, before: 'export const second = 1;', after: 'export const second = 2;' });
  const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from).endsWith('.tmp') && String(to).endsWith('second.ts')) {
      if (concurrentEdit) writeFileSync(file, 'export const userEdit = true;');
      throw new Error('Simulated replacement failure');
    }
    rename(from, to);
  });
  expect(() => writeVerifiedPatch(project, result, root)).toThrow(/Simulated replacement failure/);
  expect(readFileSync(file, 'utf8')).toBe(concurrentEdit ? 'export const userEdit = true;' : before);
  expect(readFileSync(second, 'utf8')).toBe('export const second = 1;');
  expect(readdirSync(root).filter((name) => name.endsWith('.bak'))).toHaveLength(concurrentEdit ? 1 : 0);
  expect(readdirSync(root)).not.toContain('.autopatch.lock');
});

test('reports cleanup trouble as a warning after successful writes and still releases the lock', () => {
  const { root, file, project, result } = setup();
  const remove = fs.rmSync;
  vi.spyOn(fs, 'rmSync').mockImplementation((path, options) => {
    if (String(path).endsWith('.bak')) throw new Error('Simulated cleanup failure');
    remove(path, options);
  });
  const warnings = writeVerifiedPatch(project, result, root);
  expect(warnings).toEqual([expect.stringContaining('cleanup')]);
  expect(readFileSync(file, 'utf8')).toBe('export const count: number = 2;');
  expect(readdirSync(root)).not.toContain('.autopatch.lock');
});

test('enforces strict null checking again at the persistence boundary', () => {
  const { root, file, before, project, result } = setup();
  project.compilerOptions.set({ strictNullChecks: false });
  result.files[0]!.after = 'export const count: number = null;';
  expect(() => writeVerifiedPatch(project, result, root)).toThrow(/compiler validation/i);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect(project.getCompilerOptions().strictNullChecks).toBe(false);
});
