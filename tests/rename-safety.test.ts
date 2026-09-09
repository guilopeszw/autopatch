import { Project } from "ts-morph";
import { expect, test } from "vitest";
import { migrateProject } from "../src/core/runner/migration.js";

test('blocks optional-property renames when inferred producer fields escape symbol references', async () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  project.createSourceFile('/api.ts', '');
  project.createSourceFile('/consumer.ts', '');
  const bindings = { operations: { submit: { file: '/api.ts', export: 'submit' } }, schemas: { Input: { file: '/api.ts', export: 'Input' } } };
  project.getSourceFileOrThrow('/api.ts').replaceWithText('export interface Input { id: string; name?: string }\nexport function submit(input: Input) { return input.name; }');
  project.getSourceFileOrThrow('/consumer.ts').replaceWithText('import { submit } from "./api.js"; const input = { id: "1", name: "Ada" }; export const result = submit(input);');
  const original = project.getSourceFiles().map((source) => source.getFullText());
  const document = (renamed: boolean) => ({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: {}, components: { schemas: {
    Input: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, ...(renamed
      ? { displayName: { type: 'string', 'x-autopatch-previous-name': 'name' } }
      : { name: { type: 'string' } }) } },
  } } });
  const result = await migrateProject(project, document(false), document(true), bindings);
  expect(result.status).toBe('blocked');
  expect(result.issues.join(' ')).toMatch(/structural.*flow/i);
  expect(result.files).toEqual([]);
  expect(project.getSourceFiles().map((source) => source.getFullText())).toEqual(original);
});

test.each([
  'const items = [{ id: "1", name: "Ada" }]; const typed: Input[] = items;',
  'const value = { inner: { id: "1", name: "Ada" } }; const typed: { inner: Input } = value;',
  'const producer = () => ({ id: "1", name: "Ada" }); const typed: () => Input = producer;',
  'const value: any = { id: "1", name: "Ada" }; const typed: Input = value;',
])('blocks unproven fields through container and callback boundaries: %s', async (consumer) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  project.createSourceFile('/api.ts', 'export interface Input { id: string; name?: string }');
  project.createSourceFile('/consumer.ts', `import type { Input } from "./api"; ${consumer}`);
  const document = (renamed: boolean) => ({ openapi: '3.1.0', info: {}, paths: {}, components: { schemas: {
    Input: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, ...(renamed
      ? { displayName: { type: 'string', 'x-autopatch-previous-name': 'name' } }
      : { name: { type: 'string' } }) } },
  } } });
  const result = await migrateProject(project, document(false), document(true), {
    operations: {}, schemas: { Input: { file: '/api.ts', export: 'Input' } },
  });
  expect(result.status).toBe('blocked');
  expect(result.issues.join(' ')).toMatch(/structural.*flow/i);
  expect(result.files).toEqual([]);
});
