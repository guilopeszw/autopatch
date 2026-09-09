import { Project } from "ts-morph";
import { expect, test } from "vitest";
import { checkProject } from "../src/core/runner/type-checker.js";

test("rejects unsaved type errors and accepts an in-memory correction", () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const source = project.createSourceFile("/input.ts", 'const count: number = "wrong";');
  expect(checkProject(project)).toMatchObject({
    success: false,
    errors: [{ code: 2322, file: "/input.ts", line: 1 }],
  });
  source.replaceWithText("const count: number = 42;");
  expect(checkProject(project)).toEqual({ success: true, errors: [] });
});
