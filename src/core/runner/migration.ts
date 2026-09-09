import type { Project } from "ts-morph";
import { applyCodemods, type Bindings } from "../ast/codemod-builder.js";
import { diffOpenApi, type SchemaChange } from "../diff/openapi-differ.js";
import { checkProject, type CompilerError } from "./type-checker.js";

/** A verified edit includes its preimage so the writer can detect stale plans. */
export interface FilePatch { path: string; before: string; after: string }
export interface MigrationResult {
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
  project: Project, before: unknown, after: unknown, bindings: Bindings,
): Promise<MigrationResult> {
  project.resolveSourceFileDependencies();
  const options = project.getCompilerOptions();
  const originals = new Map(project.getSourceFiles().map((source) => [source, source.getFullText()]));
  const result: MigrationResult = { status: "blocked", changes: [], files: [], diagnostics: [], issues: [] };
  try {
    project.compilerOptions.set({ strict: true, noEmit: true, noCheck: false, skipLibCheck: false });
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
    const validation = checkProject(project);
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
    project.compilerOptions.set(options);
  }
}
