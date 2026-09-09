import type { CallExpression, Project } from "ts-morph";
import { applyCodemods, resolveOperation, type Bindings } from "../ast/codemod-builder.js";
import { findCallSites } from "../ast/callsite-finder.js";
import { repairCallSites, type RepairOptions, type RepairTransport } from "../agent/llm-fixer.js";
import { diffOpenApi, type SchemaChange } from "../diff/openapi-differ.js";
import { VALIDATION_COMPILER_OPTIONS, checkProject, type CompilerError } from "./type-checker.js";

/** A verified edit includes its preimage so the writer can detect stale plans. */
export interface FilePatch { path: string; before: string; after: string }
export interface MigrationOptions { repair?: RepairOptions & { transport: RepairTransport } }
export interface MigrationResult {
  llmAttempts: number;
  status: "verified" | "blocked";
  changes: SchemaChange[];
  files: FilePatch[];
  diagnostics: CompilerError[];
  issues: string[];
}

/**
 * Plan a migration transaction entirely in memory. Both the baseline and patched
 * program must pass the compiler. Always restore the caller's source text, even
 * after success, so dry runs cannot leak edits into a reused Project.
 *
 * The returned files are a reviewable plan, not permission to bypass validation:
 * the disk writer must verify them again immediately before persistence.
 */
export async function migrateProject(
  project: Project, before: unknown, after: unknown, bindings: Bindings, options: MigrationOptions = {},
): Promise<MigrationResult> {
  project.resolveSourceFileDependencies();
  const compilerOptions = project.getCompilerOptions();
  const originals = new Map(project.getSourceFiles().map((source) => [source, source.getFullText()]));
  const result: MigrationResult = { status: "blocked", llmAttempts: 0, changes: [], files: [], diagnostics: [], issues: [] };
  try {
    project.compilerOptions.set(VALIDATION_COMPILER_OPTIONS);
    const baseline = checkProject(project);
    if (!baseline.success) {
      result.diagnostics = baseline.errors;
      result.issues.push("Baseline project must compile before migration");
      return result;
    }
    result.changes = diffOpenApi(before, after);
    const unsupported = result.changes.filter((change) => change.kind === "unsupported");
    if (unsupported.length) {
      result.issues = unsupported.map((change) => `${change.location}: ${change.reason}`);
      return result;
    }
    applyCodemods(project, result.changes, bindings);
    let validation = checkProject(project);
    if (!validation.success && options.repair) {
      const candidates = new Set<CallExpression>();
      for (const [id, binding] of Object.entries(bindings.operations)) {
        const rename = result.changes.find((change) => change.kind === "operation-renamed" && change.from === id);
        const declaration = resolveOperation(project, { ...binding, export: rename?.kind === "operation-renamed" ? rename.to : binding.export });
        for (const call of findCallSites(declaration)) {
          if (validation.errors.some((error) => containsError(call, error))) candidates.add(call);
        }
      }
      // A containing call already supplies enough context to repair nested calls.
      const calls = [...candidates].filter((call) => ![...candidates].some((other) =>
        other !== call && other.getSourceFile() === call.getSourceFile() && other.getStart() <= call.getStart() && other.getEnd() >= call.getEnd()));
      if (validation.errors.every((error) => calls.some((call) => containsError(call, error)))) {
        const repair = await repairCallSites(project, calls, result.changes, options.repair.transport, options.repair);
        result.llmAttempts = repair.attempts;
        result.issues.push(...repair.issues);
        validation = checkProject(project);
      } else {
        result.issues.push("Compiler errors outside bound call sites require manual changes");
      }
    }
    result.diagnostics = validation.errors;
    if (!validation.success) {
      result.issues.push("Migrated project has compiler errors; no patch may be written");
      return result;
    }
    for (const [source, original] of originals) {
      const patched = source.getFullText();
      if (original !== patched) result.files.push({ path: source.getFilePath(), before: original, after: patched });
    }
    result.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    result.status = "verified";
    return result;
  } catch (error) {
    result.files = [];
    result.issues.push(error instanceof Error ? error.message : String(error));
    return result;
  } finally {
    for (const [source, original] of originals) {
      if (source.getFullText() !== original) source.replaceWithText(original);
    }
    project.compilerOptions.reset();
    project.compilerOptions.set(compilerOptions);
  }
}

function containsError(call: CallExpression, error: CompilerError): boolean {
  return error.file === call.getSourceFile().getFilePath() && error.start !== undefined &&
    error.start >= call.getStart() && error.start < call.getEnd();
}
