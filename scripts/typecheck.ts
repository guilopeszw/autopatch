import { Project } from "ts-morph";
import { checkProject } from "../src/core/runner/type-checker.js";

const result = checkProject(new Project({ tsConfigFilePath: "tsconfig.json" }));
for (const error of result.errors) {
  console.error(`${error.file ?? "project"}:${error.line ?? 0} TS${error.code}: ${error.message}`);
}
console.log(`${result.errors.length} compiler errors (in-memory, no emit).`);
process.exitCode = result.success ? 0 : 1;
