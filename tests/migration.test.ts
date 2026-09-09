import { Project, ts } from "ts-morph";
import { expect, test } from "vitest";
import { migrateProject } from "../src/core/runner/migration.js";

function setup() {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: {
    strict: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  } });
  project.createSourceFile('/api.ts', 'export interface Input { count: string }\nexport function submit(input: Input): void {}');
  project.createSourceFile('/consumer.ts', 'import { submit } from "./api.js"; submit({ count: "3" });');
  const bindings = { operations: { submit: { file: '/api.ts', export: 'submit' } }, schemas: { Input: { file: '/api.ts', export: 'Input' } } };
  const schema = (type: string) => ({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: {}, components: { schemas: { Input: { type: 'object', required: ['count'], properties: { count: { type } } } } } });
  return { project, bindings, schema };
}

test("rolls back every in-memory edit when the migrated contract fails the compiler gate", async () => {
  const { project, bindings, schema } = setup();
  const original = project.getSourceFiles().map((source) => source.getFullText());
  const result = await migrateProject(project, schema('string'), schema('number'), bindings);
  expect(result.status).toBe('blocked');
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 2322 }));
  expect(result.files).toEqual([]);
  expect(project.getSourceFiles().map((source) => source.getFullText())).toEqual(original);
});

test("returns a verified patch without changing the caller's project", async () => {
  const { project, bindings, schema } = setup();
  const before = schema('string');
  const after = schema('string');
  Object.assign(after.components.schemas.Input.properties, { enabled: { type: 'boolean' } });
  const original = project.getSourceFileOrThrow('/api.ts').getFullText();
  const result = await migrateProject(project, before, after, bindings);
  expect(result.status).toBe('verified');
  expect(result.diagnostics).toEqual([]);
  expect(result.files).toHaveLength(1);
  expect(result.files[0]?.after).toContain('"enabled"?: boolean');
  expect(project.getSourceFileOrThrow('/api.ts').getFullText()).toBe(original);
});

test("does not let noCheck or skipLibCheck hide baseline errors", async () => {
  const { project, bindings, schema } = setup();
  project.compilerOptions.set({ noCheck: true, skipLibCheck: true });
  project.createSourceFile('/broken.d.ts', 'declare const value: MissingType;');
  const result = await migrateProject(project, schema('string'), schema('number'), bindings);
  expect(result.status).toBe('blocked');
  expect(result.issues).toContain('Baseline project must compile before migration');
  expect(result.files).toEqual([]);
  expect(project.getCompilerOptions().noCheck).toBe(true);
});
