import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { Project } from "ts-morph";
import { createRepairTransport } from "./core/agent/providers.js";
import type { MigrationOptions, MigrationResult } from "./core/runner/migration.js";
import { planFileMigration } from "./core/runner/file-planner.js";
import { writeVerifiedPatch } from "./core/runner/patch-writer.js";
import { renderHtmlReport } from "./report/html-report.js";

interface Output { out: (text: string) => void; err: (text: string) => void }
interface CliOptions {
  from: string; to: string; project: string; bindings: string;
  write?: boolean; dryRun?: boolean; check?: boolean; json?: boolean; report?: string;
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
    .option("--report <file.html>", "create a standalone HTML review of the plan (must be a new file)")
    .addOption(new Option("--llm <provider>", "opt in to isolated repair requests").choices(["none", "openai", "anthropic"]).default("none"))
    .option("--model <id>", "explicit provider model ID; required with --llm")
    .option("--max-attempts <number>", "maximum repair rounds (1–5)", integer(1, 5), 2)
    .option("--timeout-ms <number>", "timeout per provider request (1–120000)", integer(1, 120_000), 30_000)
    .exitOverride()
    .configureOutput({ writeOut: output.out, writeErr: output.err });

  program.action(async (options: CliOptions) => {
    const configPath = resolve(options.project);
    const root = dirname(configPath);
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
    const result = await planFileMigration(options, migrationOptions);
    if (options.report) {
      if (!options.report.endsWith(".html")) throw new Error("--report requires a new .html file");
      // Exclusive creation prevents source/report overwrites. Export before any
      // persistence so a failed report destination cannot leave a written patch.
      writeFileSync(resolve(options.report), renderHtmlReport(result, { root, from: options.from, to: options.to }), { flag: "wx", mode: 0o600 });
    }
    let written = false;
    let warnings: string[] = [];
    if (options.write && result.status === "verified") {
      // Reload config and dependencies so long-running repairs cannot validate
      // persistence against a stale on-disk compiler configuration.
      warnings = writeVerifiedPatch(new Project({ tsConfigFilePath: configPath }), result, root);
      written = result.files.length > 0;
    }
    output.out(options.json ? `${JSON.stringify({ ...result, written, warnings }, null, 2)}\n` : formatReport(result, written) + warnings.map((warning) => `Warning: ${warning}\n`).join(""));
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
