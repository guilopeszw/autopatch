import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Project } from "ts-morph";
import type { MigrationResult } from "./migration.js";
import { VALIDATION_COMPILER_OPTIONS, checkProject } from "./type-checker.js";

/**
 * Persist only a fresh, compiler-valid plan. Files must already exist inside the
 * project root. Stage replacements and recovery copies beside each destination,
 * then rename them into place under a per-project exclusive lock.
 *
 * ponytail: renames are atomic per file, not across files. Ordinary write errors
 * roll back; process/power failure may leave a lock and recovery copies. A durable
 * journal is required for crash-atomic multi-file transactions.
 */
export function writeVerifiedPatch(project: Project, result: MigrationResult, root: string): string[] {
  if (result.status !== "verified" || result.diagnostics.length || result.issues.length) throw new Error("Only a verified migration can be written");
  if (!result.files.length) return [];
  const realRoot = fs.realpathSync(root);
  const lockPath = join(realRoot, ".autopatch.lock");
  const lock = fs.openSync(lockPath, "wx", 0o600);
  const originals = new Map(project.getSourceFiles().map((source) => [source, source.getFullText()]));
  const compilerOptions = project.getCompilerOptions();
  const staged: { before: string; after: string; path: string; temporary: string; backup: string; applied: boolean; preserveBackup: boolean }[] = [];
  let committed = false;
  const warnings: string[] = [];
  try {
    const seen = new Set<string>();
    for (const patch of result.files) {
      if (!isAbsolute(patch.path) || fs.lstatSync(patch.path).isSymbolicLink()) throw new Error(`Invalid patch path: ${patch.path}`);
      const path = fs.realpathSync(patch.path);
      const local = relative(realRoot, path);
      if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local) || local.split(sep).includes("node_modules")) {
        throw new Error(`Patch escapes the writable project: ${patch.path}`);
      }
      if (seen.has(path)) throw new Error(`Duplicate patch path: ${path}`);
      seen.add(path);
      const source = project.getSourceFileOrThrow(patch.path);
      if (source.getFullText() !== patch.before || fs.readFileSync(path, "utf8") !== patch.before) throw new Error(`Stale patch: ${path}`);
      source.replaceWithText(patch.after);
    }
    project.compilerOptions.set(VALIDATION_COMPILER_OPTIONS);
    const validation = checkProject(project);
    if (!validation.success) throw new Error(`Patch failed compiler validation: ${validation.errors.map((error) => `TS${error.code}`).join(", ")}`);
    // Detect edits to other loaded sources made while the migration was planning.
    for (const [source, before] of originals) {
      if (fs.readFileSync(source.getFilePath(), "utf8") !== before) throw new Error(`Project changed during planning: ${source.getFilePath()}`);
    }
    for (const patch of result.files) {
      const path = fs.realpathSync(patch.path);
      const prefix = join(dirname(path), `.autopatch-${randomUUID()}`);
      const entry = { path, before: patch.before, after: patch.after, temporary: `${prefix}.tmp`, backup: `${prefix}.bak`, applied: false, preserveBackup: false };
      staged.push(entry);
      const mode = fs.statSync(path).mode & 0o777;
      fs.writeFileSync(entry.temporary, patch.after, { flag: "wx", mode });
      fs.writeFileSync(entry.backup, patch.before, { flag: "wx", mode });
    }
    for (const entry of staged) {
      if (fs.readFileSync(entry.path, "utf8") !== entry.before) throw new Error(`File changed before replacement: ${entry.path}`);
      fs.renameSync(entry.temporary, entry.path);
      entry.applied = true;
    }
    committed = true;
  } catch (error) {
    const recoveryErrors: string[] = [];
    for (const entry of [...staged].reverse()) {
      if (!entry.applied) continue;
      try {
        if (fs.readFileSync(entry.path, "utf8") !== entry.after) throw new Error("Concurrent edit during rollback");
        fs.renameSync(entry.backup, entry.path);
      }
      catch {
        entry.preserveBackup = true;
        recoveryErrors.push(`Restore ${entry.path} from ${entry.backup}`);
      }
    }
    if (recoveryErrors.length) throw new Error(`${error instanceof Error ? error.message : String(error)}; ${recoveryErrors.join("; ")}`);
    throw error;
  } finally {
    if (!committed) for (const [source, text] of originals) if (source.getFullText() !== text) source.replaceWithText(text);
    project.compilerOptions.reset();
    project.compilerOptions.set(compilerOptions);
    const cleanup = (path: string) => {
      try { fs.rmSync(path, { force: true }); }
      catch { warnings.push(`File cleanup failed; inspect and remove ${path}`); }
    };
    for (const entry of staged) {
      cleanup(entry.temporary);
      if (!entry.preserveBackup) cleanup(entry.backup);
    }
    try { fs.closeSync(lock); }
    catch { warnings.push("Lock cleanup failed while closing its file descriptor"); }
    cleanup(lockPath);
  }
  return warnings;
}
