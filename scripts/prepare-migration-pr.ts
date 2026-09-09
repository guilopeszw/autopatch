/**
 * Prepare a draft-PR commit in a clean, disposable Git checkout. This process
 * never pushes, opens a PR, runs target code, or calls a model. GitHub Actions
 * owns those external steps after this command and repository checks succeed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Command } from "commander";
import { Project } from "ts-morph";
import { runCli } from "../src/cli.js";
import type { MigrationResult } from "../src/core/runner/migration.js";
import { writeVerifiedPatch } from "../src/core/runner/patch-writer.js";

const command = new Command().requiredOption("--config <file>", "tracked migration config, paths relative to repository root")
  .requiredOption("--output <directory>", "new artifact directory outside the repository");
command.parse();
const options = command.opts<{ config: string; output: string }>();
const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8", maxBuffer: 10_000_000 });

try {
  const root = realpathSync(git("rev-parse", "--show-toplevel").trim());
  process.chdir(root);
  const outside = (path: string): boolean => {
    const local = relative(root, path);
    return local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local);
  };
  if (git("status", "--porcelain", "--untracked-files=no").trim()) throw new Error("Use a clean disposable checkout; tracked files have local changes");
  const tracked = new Set(git("ls-files", "-z").split("\0").filter(Boolean));
  const localPath = (path: string): string => relative(root, path).split(sep).join("/");
  const inputPath = (value: unknown): string => {
    if (typeof value !== "string" || !value || isAbsolute(value)) throw new Error("Config paths must be repository-relative files");
    const path = resolve(root, value);
    if (outside(path) || realpathSync(path) !== path || !tracked.has(localPath(path)) || !statSync(path).isFile()) {
      throw new Error(`Input must be a tracked file inside the repository without symlinks: ${value}`);
    }
    return path;
  };
  const configPath = inputPath(options.config);
  if (statSync(configPath).size > 16_000) throw new Error("Migration config exceeds 16000 bytes");
  const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).sort().join(",") !== "bindings,from,project,to") throw new Error("Config must contain exactly from, to, project, and bindings");
  const values = config as Record<string, unknown>;
  const from = inputPath(values.from), to = inputPath(values.to), project = inputPath(values.project), bindings = inputPath(values.bindings);
  if (from === to) throw new Error("Baseline and target must be different files");
  const baseline = readFileSync(from, "utf8"), target = readFileSync(to, "utf8"), originalBindings = readFileSync(bindings, "utf8");
  const destination = resolve(options.output);
  const output = join(realpathSync(dirname(destination)), basename(destination));
  if (!outside(output)) throw new Error("Artifact directory must be outside the repository");
  mkdirSync(output, { mode: 0o700 });
  const write = (name: string, text: string) => writeFileSync(join(output, name), text, { flag: "wx", mode: 0o600 });
  let json = "";
  let error = "";
  const code = await runCli(["--from", from, "--to", to, "--project", project, "--bindings", bindings,
    "--json", "--report", join(output, "review.html")], { out: text => { json += text; }, err: text => { error += text; } });
  write("result.json", json);
  // The JSON originates from our in-process CLI, not an external report file.
  // Never accept user-supplied plans as authority for writing or staging files.
  if (code !== 0) {
    write("manifest.json", JSON.stringify({ status: "blocked", files: [] }, null, 2));
    write("body.md", "AutoPatch could not prepare a verified migration. Inspect result.json and review.html for findings.\n");
    process.stderr.write(error || "Migration blocked; artifacts contain the findings.\n");
    process.exitCode = code;
  } else {
    const result = JSON.parse(json) as MigrationResult;
    const files = result.files.map(file => localPath(file.path));
    for (const path of files) if (!tracked.has(path)) throw new Error(`Refusing to stage an untracked source: ${path}`);
    // The CLI has validated this document. Advance operation keys and exported
    // declaration names with the code; otherwise the next schema diff is unbound.
    const nextBindings = JSON.parse(originalBindings) as { operations?: Record<string, { file: string; export: string }> };
    const names = new Set<string>();
    let bindingsChanged = false;
    const operations = Object.entries(nextBindings.operations ?? {}).map(([id, binding]) => {
      const rename = result.changes.find(change => change.kind === "operation-renamed" && change.from === id);
      const name = rename?.kind === "operation-renamed" ? rename.to : id;
      if (names.has(name)) throw new Error(`Operation binding collision: ${name}`);
      names.add(name);
      if (name !== id) bindingsChanged = true;
      return [name, name === id ? binding : { ...binding, export: name }];
    });
    if (bindingsChanged) nextBindings.operations = Object.fromEntries(operations);
    if (readFileSync(from, "utf8") !== baseline || readFileSync(to, "utf8") !== target || readFileSync(bindings, "utf8") !== originalBindings) {
      throw new Error("Schemas or bindings changed during planning");
    }
    const warnings = writeVerifiedPatch(new Project({ tsConfigFilePath: project }), result, dirname(project));
    // Baseline advancement and source changes are staged in the same Git commit.
    // A disk error fails this command; callers must discard this disposable
    // checkout rather than publish a partial result.
    if (baseline !== target) {
      writeFileSync(from, target);
      files.push(localPath(from));
    }
    if (bindingsChanged) {
      writeFileSync(bindings, `${JSON.stringify(nextBindings, null, 2)}\n`);
      files.push(localPath(bindings));
    }
    files.sort();
    if (files.length) git("add", "--", ...files);
    write("manifest.json", JSON.stringify({ status: files.length ? "ready" : "noop", files, head: git("rev-parse", "HEAD").trim(), warnings }, null, 2));
    write("body.md", `## API contract migration\n\nAutoPatch prepared ${result.changes.length} schema changes across ${result.files.length} source files. The baseline and proposed project passed strict in-memory TypeScript validation with zero compiler errors. No LLM was enabled.\n\nThe recorded schema baseline advances in the same commit. Review the attached HTML/JSON artifacts and source diff before merging. Type checking does not establish business correctness.\n`);
    process.stdout.write(`${files.length ? "ready" : "noop"}: ${files.length} tracked files staged\n`);
  }
} catch (error) {
  process.stderr.write(`AutoPatch PR preparation: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
