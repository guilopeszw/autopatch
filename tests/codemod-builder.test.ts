import { Project, ts } from "ts-morph";
import { expect, test } from "vitest";
import { applyCodemods } from "../src/core/ast/codemod-builder.js";
import { checkProject } from "../src/core/runner/type-checker.js";

function target() {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: {
    strict: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  } });
  const api = project.createSourceFile("/api.ts", `
    export interface Input { name: string; }
    export function create(input: Input): string { return input.name; }
  `);
  const consumer = project.createSourceFile("/consumer.ts", `
    import { create as save } from './api.js';
    import type { Input } from './api.js';
    const name = 'Ada';
    const input: Input = { name };
    save(input);
    save({ name: 'Grace' });
    const other = { name: 'unchanged' };
  `);
  return { project, api, consumer };
}

const bindings = {
  operations: { create: { file: "/api.ts", export: "create" } },
  schemas: { Input: { file: "/api.ts", export: "Input" } },
};

test("renames bound symbols across imports and shorthand objects without changing unrelated fields", () => {
  const { project, api, consumer } = target();
  applyCodemods(project, [
    { kind: "operation-renamed", method: "post", path: "/users", from: "create", to: "register" },
    { kind: "property-renamed", schema: "Input", from: "name", to: "displayName" },
  ], bindings);
  expect(api.getFunction("register")).toBeDefined();
  expect(api.getInterfaceOrThrow("Input").getProperty("displayName")).toBeDefined();
  expect(consumer.getFullText()).toContain("register as save");
  expect(consumer.getFullText()).toContain("displayName: name");
  expect(consumer.getFullText()).toContain("displayName: 'Grace'");
  expect(consumer.getFullText()).toContain("{ name: 'unchanged' }");
  expect(checkProject(project).errors).toEqual([]);
});

test("updates a bound contract and exposes affected consumers to the compiler gate", () => {
  const { project, api } = target();
  applyCodemods(project, [{
    kind: "property-updated", schema: "Input", property: "name",
    before: { schema: { type: "string" }, required: true },
    after: { schema: { type: "array", items: { type: "string", enum: ["Ada", "Grace"] } }, required: true },
  }], bindings);
  expect(api.getInterfaceOrThrow("Input").getPropertyOrThrow("name").getTypeNodeOrThrow().getText()).toBe('("Ada" | "Grace")[]');
  expect(checkProject(project).success).toBe(false);
});

test("rejects a rename that could capture an existing local binding", () => {
  const { project, consumer } = target();
  consumer.addStatements("function nested() { const register = () => 'wrong'; return save({ name: register() }); }");
  expect(() => applyCodemods(project, [
    { kind: "operation-renamed", method: "post", path: "/users", from: "create", to: "register" },
  ], bindings)).toThrow(/collision/i);
});

test("rejects a property rename into an existing contract member", () => {
  const { project, api } = target();
  api.getInterfaceOrThrow("Input").addProperty({ name: "displayName", type: "string", hasQuestionToken: true });
  expect(() => applyCodemods(project, [
    { kind: "property-renamed", schema: "Input", from: "name", to: "displayName" },
  ], bindings)).toThrow(/collision/i);
});
