import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Project } from "ts-morph";
import { writeVerifiedPatch } from "../core/runner/patch-writer.js";
import { checkProject } from "../core/runner/type-checker.js";
import { Command, CommanderError } from "commander";
import { planFileMigration, type MigrationFiles } from "../core/runner/file-planner.js";
import { renderHtmlReport } from "../report/html-report.js";
import { digest, fetchSnapshot, object, projectContract, stableJson, ScopeChangeError, type SchemaScope, type Source } from "./upstream.js";

interface Output { out(text: string): void; err(text: string): void }
interface Config { id: string; migration: string; source: Source; schemas: SchemaScope; verify: string[][] }

/** CLI for a disposable checkout. Preview is read-only; --prepare is reserved for verified delivery. */
export async function runMonitorCli(args: readonly string[], output: Output = { out: text => process.stdout.write(text), err: text => process.stderr.write(text) }, fetcher: typeof fetch = fetch): Promise<number> {
  let artifact: string | undefined;
  let id = "unknown";
  try {
    const command = new Command().exitOverride().configureOutput({ writeOut: output.out, writeErr: output.err })
      .requiredOption("--config <file>", "tracked monitor configuration")
      .requiredOption("--output <directory>", "new artifact directory outside the checkout")
      .option("--root <directory>", "repository checkout", process.cwd())
      .option("--prepare", "write verified files and run approved application checks in a disposable checkout");
    command.parse([...args], { from: "user" });
    const options = command.opts<{ root: string; config: string; output: string; prepare?: boolean }>();
    const root = realpathSync(options.root);
    const git = (...values: string[]) => execFileSync("git", values, { cwd: root, encoding: "utf8", maxBuffer: 10_000_000 });
    if (realpathSync(git("rev-parse", "--show-toplevel").trim()) !== root) throw new Error("--root must be the repository root");
    if (git("status", "--porcelain", "--untracked-files=no").trim()) throw new Error("Use a clean disposable checkout");
    const outside = (path: string) => { const local = relative(root, path); return local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local); };
    const tracked = new Set(git("ls-files", "-z").split("\0").filter(Boolean));
    const localPath = (path: string) => relative(root, path).split(sep).join("/");
    const inputPath = (value: unknown): string => {
      if (typeof value !== "string" || !value || isAbsolute(value)) throw new Error("Config paths must be repository-relative files");
      const path = resolve(root, value);
      if (outside(path) || !tracked.has(localPath(path)) || realpathSync(path) !== path || !statSync(path).isFile()) throw new Error("Inputs must be tracked files without symlinks");
      return path;
    };
    const requested = resolve(options.output);
    const directory = join(realpathSync(dirname(requested)), basename(requested));
    if (!outside(directory)) throw new Error("Artifact directory must be outside the repository");
    mkdirSync(directory, { mode: 0o700 });
    artifact = directory;
    const configPath = inputPath(options.config);
    const config = parseConfig(readJson(configPath, 64_000)); id = config.id;
    const migration = object(readJson(inputPath(config.migration), 16_000), "migration config");
    if (Object.keys(migration).sort().join(",") !== "bindings,from,project,to") throw new Error("Migration config must contain exactly from, to, project, and bindings");
    const files: MigrationFiles = { from: inputPath(migration.from), to: inputPath(migration.to), project: inputPath(migration.project), bindings: inputPath(migration.bindings) };
    if (new Set(Object.values(files)).size !== 4) throw new Error("Migration input paths must be distinct");
    const inputs = new Map([configPath, inputPath(config.migration), ...Object.values(files)].map(path => [path, readFileSync(path, "utf8")]));
    const assertInputsUnchanged = () => {
      for (const [path, text] of inputs) if (readFileSync(path, "utf8") !== text) throw new Error("Monitor inputs changed during planning");
    };
    const snapshot = await fetchSnapshot(config.source, fetcher);
    assertInputsUnchanged();
    writeFileSync(join(artifact, config.source.path.endsWith(".json") ? "upstream.json" : "upstream.yaml"), snapshot.text, { flag: "wx", mode: 0o600 });
    const candidate = projectContract(snapshot.document, readJson(files.from), config.schemas);
    const candidatePath = join(artifact, "candidate.json"); writeFileSync(candidatePath, stableJson(candidate), { flag: "wx", mode: 0o600 });
    const result = await planFileMigration({ ...files, to: candidatePath });
    writeFileSync(join(artifact, "result.json"), stableJson(result), { flag: "wx", mode: 0o600 });
    writeFileSync(join(artifact, "review.html"), renderHtmlReport(result, { root: dirname(files.project), from: files.from, to: config.source.path }), { flag: "wx", mode: 0o600 });
    let status = result.status === "blocked" ? "blocked" : result.changes.length ? "ready" : "unchanged";
    const eventKey = digest(stableJson({ config, changes: result.changes, bindings: readJson(files.bindings) }));
    const manifest = { id, status, prepared: false, head: git("rev-parse", "HEAD").trim(), patchSha256: "", eventKey, source: { ...config.source, revision: snapshot.revision, url: snapshot.url, sha256: snapshot.sha256 }, files: [] as string[], issues: [...result.issues] };
    if (options.prepare && status === "ready") {
      assertInputsUnchanged();
      const edits = new Map(result.files.map(file => [file.path, { before: file.before, after: file.after }]));
      for (const path of edits.keys()) {
        if (outside(path) || !tracked.has(localPath(path)) || realpathSync(path) !== path || Object.values(files).includes(path) || path === configPath) throw new Error("Source edits must be tracked and separate from configuration");
      }
      const candidateText = readFileSync(candidatePath, "utf8");
      for (const path of [files.from, files.to]) {
        const before = readFileSync(path, "utf8");
        if (before !== candidateText) edits.set(path, { before, after: candidateText });
      }
      const checks: { command: string[]; status: string }[] = [];
      try {
        writeVerifiedPatch(new Project({ tsConfigFilePath: files.project }), result, dirname(files.project));
        for (const path of [files.from, files.to]) if (edits.has(path)) writeFileSync(path, candidateText);
        // Only commands from the trusted, tracked configuration run. Provider
        // documents cannot provide commands; model repair is never enabled here.
        for (const [executable, ...arguments_] of config.verify) {
          const check = { command: [executable!, ...arguments_], status: "failed" }; checks.push(check);
          const environment = { ...process.env }; delete environment.GH_TOKEN; delete environment.GITHUB_TOKEN;
          execFileSync(executable!, arguments_, { cwd: root, env: environment, timeout: 120_000, maxBuffer: 1_000_000, stdio: "pipe" });
          check.status = "passed";
        }
        for (const path of git("diff", "--name-only", "-z").split("\0").filter(Boolean)) {
          if (!edits.has(resolve(root, path))) throw new Error("Application checks modified unrelated tracked files");
        }
        for (const [path, edit] of edits) if (readFileSync(path, "utf8") !== edit.after) throw new Error("Prepared files changed during application checks");
        if (!checkProject(new Project({ tsConfigFilePath: files.project })).success) throw new Error("Application checks left compiler errors");
        manifest.files = [...edits.keys()].map(localPath).sort();
        if (manifest.files.length) git("add", "--", ...manifest.files);
        manifest.patchSha256 = digest(git("diff", "--cached", "--binary", "--full-index"));
        manifest.prepared = true;
      } catch {
        // Restore only our unchanged replacements. Preserve concurrent edits;
        // the workflow discards this checkout after any failed preparation.
        for (const [path, edit] of edits) {
          try {
            // Unstage only our exact replacement; preserve any other staged edit.
            if (git("show", `:${localPath(path)}`) === edit.after) git("restore", "--staged", "--", localPath(path));
          } catch {
            manifest.issues.push(`Could not restore index entry: ${localPath(path)}`);
          }
          try {
            if (readFileSync(path, "utf8") === edit.after) writeFileSync(path, edit.before);
            else manifest.issues.push(`Preserved a concurrent edit: ${localPath(path)}`);
          } catch {
            // A deleted or unreadable file must not prevent recovery of later files.
            manifest.issues.push(`Could not restore ${localPath(path)}; inspect the disposable checkout`);
          }
        }
        status = "blocked"; manifest.status = status; manifest.files = [];
        writeFileSync(join(artifact, "failure.txt"), "Application checks or preparation failed; no PR may be published. Inspect the configured checks in a disposable checkout.\n", { flag: "wx", mode: 0o600 });
      }
      writeFileSync(join(artifact, "checks.json"), stableJson(checks), { flag: "wx", mode: 0o600 });
    }
    writeFileSync(join(artifact, "manifest.json"), stableJson(manifest), { flag: "wx", mode: 0o600 });
    const heading = status === "ready" ? "Patch ready" : status === "blocked" ? "Manual decision needed" : "No contract change";
    writeFileSync(join(artifact, "body.md"), `## ${heading}\n\n${result.changes.length} monitored contract changes; ${result.files.length} proposed source files. ${manifest.prepared ? "Compiler and configured application checks passed." : "No application checks have passed for publication."}\n\nSource: [${snapshot.revision}](${snapshot.url})\n\nRaw SHA-256: \`${snapshot.sha256}\`\n\nOnly configured schema fields and their referenced schemas were inspected. Review the HTML/JSON artifacts. Human approval is required before merging; this workflow never merges or deploys.\n`, { flag: "wx", mode: 0o600 });
    output.out(`${status}: ${id}\n`);
    return status === "blocked" ? 1 : 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ScopeChangeError ? "blocked" : "failed";
    if (artifact) {
      // Never overwrite a prior run's artifact directory after mkdir fails.
      try { writeFileSync(join(artifact, "manifest.json"), stableJson({ id, status, prepared: false, files: [], issues: [message] }), { flag: "wx", mode: 0o600 }); } catch { /* Original failure remains authoritative. */ }
    }
    output.err(`AutoPatch monitor: ${message}\n`); return status === "blocked" ? 1 : 2;
  }
}

function readJson(path: string, maxBytes = 5_000_000): unknown {
  if (statSync(path).size > maxBytes) throw new Error("Local input exceeds size limit");
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
function parseConfig(value: unknown): Config {
  const config = object(value, "monitor config");
  if (Object.keys(config).sort().join(",") !== "id,migration,schemas,source,verify" || typeof config.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(config.id) || typeof config.migration !== "string") throw new Error("Invalid monitor config");
  const source = object(config.source, "source");
  if (Object.keys(source).sort().join(",") !== "path,ref,repository" || ![source.repository, source.ref, source.path].every(value => typeof value === "string" && value.length)) throw new Error("Invalid upstream source");
  const schemas = object(config.schemas, "schemas");
  if (!Object.keys(schemas).length || Object.keys(schemas).length > 100 || !Object.values(schemas).every(fields => fields === "*" || Array.isArray(fields) && fields.length > 0 && fields.every(field => typeof field === "string" && field.length) && new Set(fields).size === fields.length)) throw new Error("Select schemas with * or nonempty unique property lists");
  if (!Array.isArray(config.verify) || !config.verify.length || config.verify.length > 10 || !config.verify.every(args => Array.isArray(args) && args.length && args.every(arg => typeof arg === "string" && arg.length))) throw new Error("verify must contain approved command argument arrays");
  return config as unknown as Config;
}
