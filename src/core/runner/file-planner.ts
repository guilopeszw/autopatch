import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Project } from "ts-morph";
import type { Bindings, SymbolBinding } from "../ast/codemod-builder.js";
import { migrateProject, type MigrationOptions, type MigrationResult } from "./migration.js";

/** Files accepted by both the interactive CLI and scheduled migration workflow. */
export interface MigrationFiles { from: string; to: string; project: string; bindings: string }

/**
 * Load and validate a local project, then return a typed, compiler-gated plan.
 * No disk writes, report rendering, or application execution happen here.
 * The source snapshot may live outside the project; bound source exports may not.
 */
export async function planFileMigration(files: MigrationFiles, options: MigrationOptions = {}): Promise<MigrationResult> {
  const configPath = resolve(files.project);
  const before = readJson(resolve(files.from));
  const after = readJson(resolve(files.to));
  const bindings = parseBindings(readJson(resolve(files.bindings), 256_000), dirname(configPath));
  return migrateProject(new Project({ tsConfigFilePath: configPath }), before, after, bindings, options);
}

function readJson(path: string, maxBytes = 5_000_000): unknown {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size > maxBytes) throw new Error(`Expected a JSON file smaller than ${maxBytes} bytes: ${path}`);
  try { return JSON.parse(readFileSync(path, "utf8")) as unknown; }
  catch { throw new Error(`Invalid JSON: ${path}. YAML is not supported; convert it to JSON first.`); }
}

/** Bindings are explicit trust-boundary input; paths are relative to the target tsconfig directory. */
function parseBindings(value: unknown, root: string): Bindings {
  const object = (input: unknown): Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Bindings must contain JSON objects");
    return input as Record<string, unknown>;
  };
  const input = object(value);
  if (Object.keys(input).some((key) => key !== "operations" && key !== "schemas")) throw new Error("Unknown bindings section");
  const section = (name: string): Record<string, SymbolBinding> => Object.fromEntries(
    Object.entries(object(input[name] ?? {})).map(([id, raw]) => {
      const binding = object(raw);
      if (Object.keys(binding).some((key) => key !== "file" && key !== "export" && !(name === "schemas" && key === "defaults")) ||
          typeof binding.file !== "string" || !binding.file || typeof binding.export !== "string" || !binding.export) {
        throw new Error(`Invalid ${name} binding: ${id}`);
      }
      const file = resolve(root, binding.file);
      const local = relative(root, file);
      if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local) || local.split(sep).includes("node_modules")) {
        throw new Error(`Binding must be inside the target project: ${id}`);
      }
      return [id, { file, export: binding.export, ...(binding.defaults === undefined ? {} : { defaults: object(binding.defaults) }) }];
    }),
  );
  return { operations: section("operations"), schemas: section("schemas") };
}

