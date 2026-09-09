import { Project, ts } from "ts-morph";
import { expect, test } from "vitest";
import { findCallSites } from "../src/core/ast/callsite-finder.js";

test("finds calls through imports and aliases without confusing unrelated names or callback references", () => {
  // Real language-service resolution across modules; no compiler or AST mocks.
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
  });
  const api = project.createSourceFile("/api.ts", `
    export function getUser(id: string): string { return id; }
  `);
  project.createSourceFile("/consumer.ts", `
    import { getUser, getUser as fetchUser } from "./api.js";
    import * as api from "./api.js";

    getUser("direct");
    fetchUser("alias");
    api.getUser("namespace");

    function withShadowedName() {
      function getUser(id: string): string { return id; }
      getUser("unrelated-local");
    }
    const other = { getUser(id: string): string { return id; } };
    other.getUser("unrelated-method");

    function register(callback: typeof getUser): void {}
    register(getUser);
  `);

  const calls = findCallSites(api.getFunctionOrThrow("getUser"));

  // Literal expectations describe which invocations may be offered to codemods.
  expect(calls.map((call) => call.getText())).toEqual([
    'getUser("direct")',
    'fetchUser("alias")',
    'api.getUser("namespace")',
  ]);
});
