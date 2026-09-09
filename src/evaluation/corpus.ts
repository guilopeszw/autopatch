import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import { Project, ts } from "ts-morph";
import type { Bindings } from "../core/ast/codemod-builder.js";
import { migrateProject } from "../core/runner/migration.js";
import { checkProject } from "../core/runner/type-checker.js";

export interface EvaluationCase {
  id: string;
  description: string;
  before: unknown;
  after: unknown;
  files: Readonly<Record<string, string>>;
  bindings: Bindings;
  expected: { status: "verified"; before: unknown; after: unknown } | { status: "blocked"; reason: string };
}

export interface EvaluationResult {
  id: string;
  passed: boolean;
  status: "verified" | "blocked" | "error";
  schemaChanges: number;
  changedFiles: number;
  diagnosticCodes: number[];
  llmRequests: number;
  errors: string[];
  observed?: { before: unknown; after: unknown };
}

/**
 * Evaluate a repository-owned fixture against literal outcomes. A rejected case
 * passes only if its expected rejection occurred and every source stayed intact.
 * Successful cases must pass the compiler and preserve their specified runtime
 * observations. No provider is installed or called on this evaluation path.
 */
export async function evaluateCase(fixture: EvaluationCase): Promise<EvaluationResult> {
  const output: EvaluationResult = { id: fixture.id, passed: false, status: "error", schemaChanges: 0,
    changedFiles: 0, diagnosticCodes: [], llmRequests: 0, errors: [] };
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: {
    strict: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  } });
  try {
    for (const [path, text] of Object.entries(fixture.files)) project.createSourceFile(path, text);
    const result = await migrateProject(project, fixture.before, fixture.after, fixture.bindings);
    output.status = result.status;
    output.schemaChanges = result.changes.length;
    output.changedFiles = result.files.length;
    output.diagnosticCodes = result.diagnostics.map((error) => error.code);
    if (result.llmAttempts !== 0) output.errors.push("Offline evaluation unexpectedly used LLM repair");
    for (const [path, original] of Object.entries(fixture.files)) {
      if (project.getSourceFileOrThrow(path).getFullText() !== original) output.errors.push(`Planning mutated ${path}`);
    }
    if (result.status !== fixture.expected.status) output.errors.push(`Expected ${fixture.expected.status}; got ${result.status}: ${result.issues.join("; ")}`);
    if (fixture.expected.status === "blocked") {
      if (result.files.length) output.errors.push("A blocked migration exposed writable patches");
      const reason = fixture.expected.reason;
      if (!result.issues.some((issue) => issue.includes(reason))) output.errors.push("Expected rejection reason was absent");
    } else if (result.status === "verified") {
      const before = executeTrustedFixture(project);
      for (const patch of result.files) project.getSourceFileOrThrow(patch.path).replaceWithText(patch.after);
      if (!checkProject(project).success) throw new Error("Returned migration plan does not typecheck");
      const after = executeTrustedFixture(project);
      output.observed = { before, after };
      if (!isDeepStrictEqual(before, fixture.expected.before)) output.errors.push("Baseline runtime observation differs from the literal expectation");
      if (!isDeepStrictEqual(after, fixture.expected.after)) output.errors.push("Migrated runtime observation differs from the literal expectation");
    }
    output.passed = output.errors.length === 0;
  } catch (error) {
    output.errors.push(error instanceof Error ? error.message : String(error));
  }
  return output;
}

/**
 * Execute only reviewed, repository-owned fixture code. Node VM is NOT a security
 * sandbox. Never route arbitrary target projects or LLM proposals through here.
 * The native compiler emits CommonJS in memory; imports resolve only to fixture
 * modules. Export `result` from /consumer.ts as a structured-cloneable observation.
 */
function executeTrustedFixture(project: Project): unknown {
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const load = (path: string): Record<string, unknown> => {
    const cached = modules.get(path);
    if (cached) return cached.exports;
    const source = project.getSourceFileOrThrow(path);
    const module = { exports: {} as Record<string, unknown> };
    modules.set(path, module);
    const emitted = ts.transpileModule(source.getFullText(), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    runInNewContext(emitted, {
      module, exports: module.exports,
      require: (specifier: string) => {
        if (!specifier.startsWith(".")) throw new Error("Fixture runtime permits only local module imports");
        let target = posix.resolve(posix.dirname(path), specifier);
        if (target.endsWith(".js")) target = `${target.slice(0, -3)}.ts`;
        else if (!target.endsWith(".ts")) target += ".ts";
        return load(target);
      },
    }, { filename: path, timeout: 1_000 });
    return module.exports;
  };
  return structuredClone(load("/consumer.ts").result);
}
