import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { Command, CommanderError } from "commander";
import { digest, object, stableJson } from "./upstream.js";

interface Output { out(text: string): void; err(text: string): void }

/**
 * Publish only the exact prepared Git diff. Reuse existing PRs; never approve,
 * merge, force-push, or update a reviewer-edited branch. Tokens exist only here,
 * after the monitor and approved application checks have finished.
 */
export async function runPublishCli(args: readonly string[], output: Output = { out: text => process.stdout.write(text), err: text => process.stderr.write(text) }, fetcher: typeof fetch = fetch): Promise<number> {
  try {
    const command = new Command().exitOverride().configureOutput({ writeOut: output.out, writeErr: output.err })
      .requiredOption("--root <directory>", "prepared repository checkout")
      .requiredOption("--output <directory>", "monitor artifacts")
      .requiredOption("--repository <owner/repo>", "destination GitHub repository")
      .requiredOption("--base <branch>", "human-reviewed destination branch")
      .option("--issue-author <login>", "GitHub login used by the publishing token", "github-actions[bot]");
    command.parse([...args], { from: "user" });
    const options = command.opts<{ root: string; output: string; repository: string; base: string; issueAuthor: string }>();
    if (!/^[a-zA-Z0-9_-]+(?:\[bot\])?$/.test(options.issueAuthor)) throw new Error("Invalid issue author login");
    const root = realpathSync(options.root);
    const git = (...values: string[]) => execFileSync("git", values, { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 10_000_000, stdio: ["ignore", "pipe", "pipe"] });
    if (realpathSync(git("rev-parse", "--show-toplevel").trim()) !== root || !/^[\w.-]+\/[\w.-]+$/.test(options.repository)) throw new Error("Invalid repository checkout or destination");
    git("check-ref-format", "--branch", options.base);
    const remote = git("config", "--get", "remote.origin.url").trim().replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
    if (remote.toLowerCase() !== `https://github.com/${options.repository}`.toLowerCase()) throw new Error("Origin does not match the destination repository");
    const token = process.env.GH_TOKEN;
    if (!token) throw new Error("GH_TOKEN is required for publication");
    const api = async (path: string, method = "GET", body?: unknown): Promise<unknown> => {
      const response = await fetcher(`https://api.github.com/repos/${options.repository}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub ${method} failed (HTTP ${response.status})`); }
      return response.json() as Promise<unknown>;
    };
    const artifact = realpathSync(options.output);
    const read = (name: string): string => {
      const path = join(artifact, name);
      if (statSync(path).size > 100_000) throw new Error("Publication artifact exceeds size limit");
      return readFileSync(path, "utf8");
    };
    const manifest = object(JSON.parse(read("manifest.json")), "manifest");
    if (typeof manifest.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(manifest.id)) throw new Error("Invalid monitor identity");
    if (!["ready", "blocked", "failed", "unchanged"].includes(String(manifest.status))) throw new Error("Invalid monitor status");
    const notify = async (status: "ready" | "unchanged" | "blocked" | "failed", link?: string): Promise<void> => {
      const marker = `<!-- autopatch-monitor:${manifest.id} -->`;
      const stateKey = digest(stableJson({ status, eventKey: manifest.eventKey ?? "", issues: manifest.issues ?? [] }));
      const stateMarker = `<!-- autopatch-state:${stateKey} -->`;
      let prior: Record<string, unknown> | undefined;
      // ponytail: bounded scan of 1,000 issues; use a stored issue number if
      // repositories outgrow this limit. Never create a duplicate after truncation.
      for (let page = 1; page <= 10; page++) {
        const issues = await api(`/issues?state=all&per_page=100&page=${page}`);
        if (!Array.isArray(issues)) throw new Error("Invalid GitHub issue response");
        prior = issues.map(issue => object(issue, "issue")).find(issue => !issue.pull_request && typeof issue.body === "string" && issue.body.includes(marker) &&
          String(object(issue.user, "issue author").login).toLowerCase() === options.issueAuthor.toLowerCase());
        if (prior || issues.length < 100) break;
        if (page === 10) throw new Error("Monitor issue lookup exceeded 1,000 issues; inspect before retrying");
      }
      if (typeof prior?.body === "string" && prior.body.includes(stateMarker)) return;
      if (!prior && (status === "ready" || status === "unchanged")) return;
      const label = status === "failed" ? "monitor failed" : status === "blocked" ? "manual decision needed" : status === "ready" ? "patch ready" : "monitor recovered";
      const runUrl = process.env.AUTOPATCH_RUN_URL;
      const runLink = runUrl?.startsWith(`https://github.com/${options.repository}/actions/runs/`) ? `\n[Run details and reports](${runUrl})\n` : "";
      const details = stableJson(manifest.issues ?? []).replace(/`/g, "\\u0060");
      const body = `${marker}\n${stateMarker}\n## ${label}\n\n${link ? `Review the draft PR: ${link}` : status === "unchanged" ? "The latest poll succeeded with no monitored contract changes." : "No patch was published. Inspect the run artifacts and configured application checks."}\n${runLink}\n\`\`\`json\n${details}\`\`\`\n\nHuman approval remains required before merging.\n`;
      const values = { title: `AutoPatch: ${manifest.id} — ${label}`, body, ...(prior ? { state: status === "ready" || status === "unchanged" ? "closed" : "open" } : {}) };
      if (prior) {
        if (!Number.isSafeInteger(prior.number) || Number(prior.number) < 1) throw new Error("Invalid monitor issue number");
        await api(`/issues/${prior.number}`, "PATCH", values);
      } else await api("/issues", "POST", values);
    };
    if (manifest.status === "blocked" || manifest.status === "failed" || manifest.status === "unchanged") {
      await notify(manifest.status); output.out(`${manifest.status}: ${manifest.id}\n`); return 0;
    }
    if (manifest.status !== "ready" || manifest.prepared !== true) throw new Error("Only prepared migrations may be published");
    if (typeof manifest.eventKey !== "string" || !/^[a-f0-9]{64}$/.test(manifest.eventKey) ||
        typeof manifest.head !== "string" || !/^[a-f0-9]{40}$/.test(manifest.head) ||
        typeof manifest.patchSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.patchSha256) ||
        !Array.isArray(manifest.files) || !manifest.files.length || !manifest.files.every(path => typeof path === "string") || new Set(manifest.files).size !== manifest.files.length) throw new Error("Invalid prepared patch identity");
    const branch = `autopatch/monitor-${manifest.id}-${manifest.eventKey.slice(0, 24)}`;
    const existing = async (): Promise<string | undefined> => {
      const pulls = await api(`/pulls?state=all&head=${encodeURIComponent(`${options.repository.split("/")[0]}:${branch}`)}&base=${encodeURIComponent(options.base)}&per_page=100`);
      if (!Array.isArray(pulls)) throw new Error("Invalid GitHub pull request response");
      const first = pulls[0] as unknown;
      if (first === undefined) return undefined;
      const url = object(first, "pull request").html_url;
      if (typeof url !== "string" || !url.startsWith(`https://github.com/${options.repository}/pull/`)) throw new Error("Invalid pull request URL");
      return url;
    };
    const prior = await existing();
    if (prior) { await notify("ready", prior); output.out(`Existing migration: ${prior}\n`); return 0; }
    const current = git("rev-parse", "HEAD").trim();
    const validateCommit = (commit: string, allowOlderBase = false): void => {
      const parents = git("rev-list", "--parents", "-n", "1", commit).trim().split(" ");
      if (parents.length !== 2 || (!allowOlderBase && parents[1] !== manifest.head) || digest(git("diff", "--binary", "--full-index", `${commit}^`, commit)) !== manifest.patchSha256) throw new Error("Existing branch differs from the verified patch; review it manually");
      if (parents[1] !== manifest.head) {
        // An interrupted publication may predate unrelated default-branch work.
        // Accept only the same patch whose merge produces exactly the tree that
        // this run verified. Never rebase or overwrite the remote review branch.
        if (git("rev-parse", "--is-shallow-repository").trim() === "true") git("fetch", "--unshallow", "origin");
        git("merge-base", "--is-ancestor", parents[1]!, String(manifest.head));
        const mergedTree = git("merge-tree", "--write-tree", String(manifest.head), commit).trim().split("\n")[0];
        if (mergedTree !== git("write-tree").trim()) throw new Error("Existing branch no longer merges to the verified tree; review it manually");
      }
    };
    if (current === manifest.head) {
      const staged = git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean).sort();
      if (JSON.stringify(staged) !== JSON.stringify([...manifest.files].sort()) || digest(git("diff", "--cached", "--binary", "--full-index")) !== manifest.patchSha256 || git("diff", "--name-only").trim()) throw new Error("Checkout differs from the verified staged patch");
    } else {
      // Resume our own commit after an interrupted push/PR request.
      if (git("branch", "--show-current").trim() !== branch || git("status", "--porcelain", "--untracked-files=no").trim()) throw new Error("Checkout changed after preparation");
      validateCommit(current);
    }
    if (git("ls-remote", "--heads", "origin", `refs/heads/${branch}`).trim()) {
      git("fetch", "--no-tags", "origin", `refs/heads/${branch}`);
      validateCommit(git("rev-parse", "FETCH_HEAD").trim(), true);
    } else {
      if (current === manifest.head) {
        git("switch", "-c", branch);
        git("-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m", `fix: update ${manifest.id} API contract`);
        validateCommit(git("rev-parse", "HEAD").trim());
      }
      git("push", "origin", `HEAD:refs/heads/${branch}`);
    }
    let url: string;
    try {
      const pull = object(await api("/pulls", "POST", { title: `fix: update ${manifest.id} API contract`, head: branch, base: options.base, draft: true, body: read("body.md") }), "created pull request");
      if (typeof pull.html_url !== "string") throw new Error("GitHub did not return a pull request URL");
      url = pull.html_url;
    } catch (error) {
      // A timed-out POST may have succeeded. Read before a future run retries it.
      const recovered = await existing(); if (!recovered) throw error; url = recovered;
    }
    await notify("ready", url);
    output.out(`Patch ready: ${url}\n`); return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    output.err(`AutoPatch publication: ${error instanceof Error ? error.message : String(error)}\n`); return 2;
  }
}
