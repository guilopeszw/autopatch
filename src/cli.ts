import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { Project } from "ts-morph";
import type { Bindings, SymbolBinding } from "./core/ast/codemod-builder.js";
import { createRepairTransport } from "./core/agent/providers.js";
import { migrateProject, type MigrationOptions, type MigrationResult } from "./core/runner/migration.js";
import { writeVerifiedPatch } from "./core/runner/patch-writer.js";

interface Output { out: (text: string) => void; err: (text: string) => void }
interface CliOptions {
  from: string; to: string; project: string; bindings: string;
  write?: boolean; dryRun?: boolean; check?: boolean; json?: boolean;
  llm: "none" | "openai" | "anthropic"; model?: string;
  maxAttempts: number; timeoutMs: number;
}

/** CLI seam: arguments exclude node/bin; return an exit code instead of terminating tests or embedders. */
export async function runCli(args: readonly string[], output: Output = {
  out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text),
}): Promise<number> {
  let exitCode = 0;
  const program = new Command()
    .name("autopatch").version("0.1.0")
    .description("Migrate explicitly bound TypeScript API symbols with a zero-error compiler gate.")
    .requiredOption("--from <file>", "previous OpenAPI 3.0/3.1 JSON document")
    .requiredOption("--to <file>", "target OpenAPI 3.0/3.1 JSON document")
    .option("--project <file>", "target tsconfig.json", "tsconfig.json")
    .requiredOption("--bindings <file>", "JSON mapping operation IDs and schema names to local exports")
    .addOption(new Option("--write", "persist verified changes").conflicts(["dryRun", "check"]))
    .addOption(new Option("--dry-run", "preview only (the default)").conflicts("write"))
    .addOption(new Option("--check", "exit 1 if a verified migration has pending edits").conflicts("write"))
    .option("--json", "emit a machine-readable report including exact before/after source")
    .addOption(new Option("--llm <provider>", "opt in to isolated repair requests").choices(["none", "openai", "anthropic"]).default("none"))
    .option("--model <id>", "explicit provider model ID; required with --llm")
    .option("--max-attempts <number>", "maximum repair rounds (1–5)", integer(1, 5), 2)
    .option("--timeout-ms <number>", "timeout per provider request (1–120000)", integer(1, 120_000), 30_000)
    .exitOverride()
    .configureOutput({ writeOut: output.out, writeErr: output.err });

  program.action(async (options: CliOptions) => {
    const configPath = resolve(options.project);
    const root = dirname(configPath);
    const before = readJson(resolve(options.from));
    const after = readJson(resolve(options.to));
    const bindings = parseBindings(readJson(resolve(options.bindings), 256_000), root);
    const migrationOptions: MigrationOptions = {};
    if (options.llm !== "none") {
      if (!options.model) throw new Error("--model is required when LLM repair is enabled");
      const environmentKey = options.llm === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      const apiKey = process.env[environmentKey];
      if (!apiKey) throw new Error(`${environmentKey} must be set to enable LLM repair`);
      migrationOptions.repair = {
        transport: createRepairTransport({ provider: options.llm, model: options.model, apiKey }),
        maxAttempts: options.maxAttempts, timeoutMs: options.timeoutMs,
      };
    } else if (options.model) throw new Error("--model requires an explicit --llm provider");
    const project = new Project({ tsConfigFilePath: configPath });
    const result = await migrateProject(project, before, after, bindings, migrationOptions);
    let written = false;
    if (options.write && result.status === "verified") {
      // Reload config and dependencies so long-running repairs cannot validate
      // persistence against a stale on-disk compiler configuration.
      writeVerifiedPatch(new Project({ tsConfigFilePath: configPath }), result, root);
      written = result.files.length > 0;
    }
    output.out(options.json ? `${JSON.stringify({ ...result, written }, null, 2)}\n` : formatReport(result, written));
    exitCode = result.status === "blocked" || (options.check && result.files.length > 0) ? 1 : 0;
  });
  try {
    await program.parseAsync([...args], { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes("--json")) output.out(`${JSON.stringify({ status: "error", written: false, issues: [message] })}\n`);
    else output.err(`AutoPatch: ${message}\n`);
    return 2;
  }
}

function integer(min: number, max: number): (value: string) => number {
  return (value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) throw new InvalidArgumentError(`Expected an integer between ${min} and ${max}`);
    return number;
  };
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
      if (Object.keys(binding).some((key) => key !== "file" && key !== "export") ||
          typeof binding.file !== "string" || !binding.file || typeof binding.export !== "string" || !binding.export) {
        throw new Error(`Invalid ${name} binding: ${id}`);
      }
      const file = resolve(root, binding.file);
      const local = relative(root, file);
      if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local) || local.split(sep).includes("node_modules")) {
        throw new Error(`Binding must be inside the target project: ${id}`);
      }
      return [id, { file, export: binding.export }];
    }),
  );
  return { operations: section("operations"), schemas: section("schemas") };
}

function formatReport(result: MigrationResult, written: boolean): string {
  const lines = [`AutoPatch: ${result.status}${written ? " (written)" : " (preview)"}`,
    `${result.changes.length} schema changes, ${result.files.length} changed files, ${result.diagnostics.length} compiler errors, ${result.llmAttempts} LLM repair rounds.`];
  for (const change of result.changes) lines.push(`  ${JSON.stringify(change)}`);
  for (const file of result.files) lines.push(`  ${file.path}`);
  for (const issue of result.issues) lines.push(`  Blocked: ${issue}`);
  for (const error of result.diagnostics) lines.push(`  ${error.file ?? "project"}:${error.line ?? 0} TS${error.code}: ${error.message}`);
  if (!written && result.files.length) lines.push("Use --json to inspect exact edits; use --write to persist a verified migration.");
  return `${lines.join("\n")}\n`;
}
