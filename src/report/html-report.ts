import { basename, relative } from "node:path";
import type { MigrationResult } from "../core/runner/migration.js";

/**
 * Render an inert, standalone review of a migration plan, never a write receipt.
 * Escape all dynamic content; native disclosures keep evidence available without
 * scripts or remote assets. Status and blocking findings remain visible on load.
 */
export function renderHtmlReport(result: MigrationResult, context: { root: string; from: string; to: string }): string {
  const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const code = (text: string): string => `<pre tabindex="0"><code>${escape(text)}</code></pre>`;
  const local = (path: string): string => escape(relative(context.root, path) || basename(path));
  const verified = result.status === "verified";
  const unchanged = verified && result.files.length === 0;
  const title = !verified ? "Migration blocked" : unchanged ? "Already up to date" : "Verified migration plan";
  const describe = (change: MigrationResult["changes"][number]): string => {
    if (change.kind === "operation-renamed") return `${change.from} → ${change.to}`;
    if (change.kind === "property-renamed") return `${change.schema}.${change.from} → ${change.to}`;
    if (change.kind === "unsupported") return `${change.location}: ${change.reason}`;
    return `${change.schema}.${change.property}`;
  };
  const changeLabel = (change: MigrationResult["changes"][number]): string => {
    if (change.kind === "operation-renamed" || change.kind === "property-renamed") return "Renamed";
    if (change.kind === "unsupported") return "Unsupported";
    return !change.after ? "Removed" : !change.before ? "Added" : "Updated";
  };
  const evidence = (index: number): string => result.evidence.filter(item => item.changeIndex === index).map(item =>
    `<div class="evidence"><h3>Bound symbol: <code>${escape(item.symbol)}</code></h3><p class="path">${local(item.declaration.path)}:${item.declaration.line}</p>
    <details><summary>Baseline declaration</summary>${code(item.declaration.snippet)}</details>
    <details><summary>References &amp; direct calls <span class="count">${item.references.length}</span></summary>
    ${item.references.map(reference => `<p class="path">${local(reference.path)}:${reference.line}</p>${code(reference.snippet)}`).join("") || '<p class="muted">No baseline references found.</p>'}</details></div>`).join("");
  // Keep findings above optional detail, especially for unsupported changes that
  // block before compiler diagnostics exist. Zero diagnostics alone is not success.
  const findings = result.issues.length || result.diagnostics.length ? `<section id="findings" aria-labelledby="findings-title">
    <h2 id="findings-title">Needs attention</h2><div class="findings">
    ${result.issues.length ? `<ul>${result.issues.map(issue => `<li>${escape(issue)}</li>`).join("")}</ul>` : ""}
    ${result.diagnostics.map(error => `<div class="diagnostic"><h3>TS${error.code} <span class="path">${error.file ? local(error.file) : "project"}:${error.line ?? 0}</span></h3>${code(error.message)}</div>`).join("")}
    </div></section>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title} · AutoPatch</title>
<style>
/* Local tokens preserve the same readable report offline, on mobile, and in print. */
:root{color-scheme:light dark;--bg:#fff;--ink:#18181b;--muted:#65656f;--line:#e4e4e7;--soft:#fafafa;--hover:#f4f4f5;--green:#187047;--green-bg:#edf8f1;--red:#b02a32;--red-bg:#fff1f2;--focus:#2563eb}
*{box-sizing:border-box}html{scroll-padding-top:24px}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:4px}a:focus-visible,summary:focus-visible,pre:focus-visible{outline:2px solid var(--focus);outline-offset:4px}
.skip{position:absolute;left:12px;top:-100px;background:var(--bg);padding:12px;z-index:2}.skip:focus{top:12px}
.shell{max-width:1080px;margin:auto;padding:0 20px}header{border-bottom:1px solid var(--line)}.bar{display:flex;align-items:center;justify-content:space-between;min-height:72px;gap:16px}.brand{font-size:18px;font-weight:650;letter-spacing:-.6px;text-decoration:none;display:flex;align-items:center;gap:10px;min-height:44px}.mark{display:grid;place-items:center;background:var(--ink);color:var(--bg);width:26px;height:26px;border-radius:7px;font:18px ui-monospace,monospace}.header-note{font-size:12px;color:var(--muted)}
main{padding-top:36px!important;padding-bottom:32px!important;min-width:0}.intro{display:flex;flex-direction:column;align-items:flex-start;gap:20px}.intro-text{min-width:0}.badge{display:inline-flex;align-items:center;gap:6px;border-radius:6px;padding:3px 8px;background:var(--green-bg);color:var(--green);font-size:12px;font-weight:600}.badge::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}.badge.blocked{background:var(--red-bg);color:var(--red)}
h1{font-size:28px;line-height:1.2;letter-spacing:-1px;font-weight:650;margin:14px 0 10px}h2{font-size:16px;letter-spacing:-.25px;font-weight:650;margin:0 0 14px}h3{font-size:14px;font-weight:600;margin:0}.lead{color:var(--muted);margin:0;max-width:620px}.button{display:inline-flex;align-items:center;justify-content:center;gap:14px;min-height:44px;padding:8px 14px;background:var(--ink);color:var(--bg);border-radius:7px;text-decoration:none;font-size:13px;font-weight:550;white-space:nowrap}.button:hover{opacity:.85}
.context{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:22px 0;color:var(--muted);font-size:12px}.context code{background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:2px 7px;overflow-wrap:anywhere;min-width:0;max-width:100%}.stats{display:grid;grid-template-columns:1fr 1fr;gap:20px 12px;margin:28px 0 24px;padding:20px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.stats div{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.stats dt{order:1;color:var(--muted);font-size:12px}.stats dd{margin:0;font-size:20px;font-weight:600;letter-spacing:-.5px}
nav{display:flex;flex-wrap:wrap;gap:4px 20px;margin-bottom:30px}nav a{display:inline-flex;align-items:center;min-height:44px;font-size:13px;color:var(--muted);text-decoration:none}nav a:hover{color:var(--ink);text-decoration:underline}
section{margin:28px 0}.section-head{display:flex;align-items:center;gap:8px;margin-bottom:14px}.section-head h2{margin:0}.count{font:11px/1.5 ui-monospace,monospace;color:var(--muted);background:var(--hover);border-radius:4px;padding:1px 6px}.panel{border:1px solid var(--line);border-radius:8px;overflow:hidden}.row+.row{border-top:1px solid var(--line)}
summary{cursor:pointer;min-height:44px;overflow-wrap:anywhere}summary:hover{background:var(--soft)}.row>summary{display:flex;align-items:center;gap:12px;padding:16px;list-style:none}.row>summary::-webkit-details-marker{display:none}.row>summary::after{content:"+";margin-left:auto;color:var(--muted);font:16px ui-monospace,monospace}.row[open]>summary::after{content:"−"}.row-title{font-size:13px;font-weight:550;min-width:0;overflow-wrap:anywhere}.tag{font-size:11px;line-height:1.6;padding:2px 7px;border:1px solid var(--line);border-radius:5px;color:var(--muted);flex-shrink:0}.detail{padding:0 16px 16px}.detail details{border-top:1px solid var(--line);margin-top:12px;padding-top:6px}.detail summary{display:list-item;align-content:center;font-size:13px;color:var(--muted)}.evidence{margin-top:20px}.path{font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);overflow-wrap:anywhere}.muted,.hint{color:var(--muted)}.hint{font-size:12px;margin:12px 0}
pre{margin:8px 0 0;padding:14px;overflow:auto;max-height:420px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;background:var(--soft);border-radius:5px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.columns{display:grid;gap:16px;min-width:0}.columns>div{min-width:0}.file-label{font-size:11px;font-weight:600;color:var(--muted)}.before pre{border-left:2px solid var(--red)}.after pre{border-left:2px solid var(--green)}
.findings{border:1px solid var(--line);border-left:3px solid var(--red);border-radius:6px;padding:16px}.findings ul{padding-left:18px;margin:0;font-size:14px;overflow-wrap:anywhere}.findings li+li{margin-top:8px}.diagnostic{margin-top:16px}.diagnostic:first-child{margin-top:0}.diagnostic h3{display:flex;gap:10px;flex-wrap:wrap}.empty{padding:18px;color:var(--muted);font-size:13px;margin:0}.verification{border-top:1px solid var(--line);padding-top:22px}.verification p{margin:8px 0;font-size:13px}.verification summary{font-size:13px;color:var(--muted);align-content:center}.verification strong{font-weight:600}footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;border-top:1px solid var(--line);padding:20px 0;margin-top:32px;font-size:11px;color:var(--muted)}
@media(min-width:720px){.shell{padding:0 40px}main{padding-top:48px!important}.intro{flex-direction:row;align-items:center;justify-content:space-between;gap:28px}.stats{grid-template-columns:repeat(4,1fr)}.columns{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
@media(prefers-color-scheme:dark){:root{--bg:#111113;--ink:#ededee;--muted:#a1a1aa;--line:#303034;--soft:#19191c;--hover:#242428;--green:#82d7a6;--green-bg:#142a20;--red:#fda4af;--red-bg:#321d23;--focus:#93b4fd}}
@media print{header,nav,.button,.skip{display:none}:root{color-scheme:light;--bg:#fff;--ink:#18181b;--muted:#52525b;--line:#d4d4d8;--soft:#fafafa;--hover:#f4f4f5;--green:#187047;--green-bg:#edf8f1;--red:#b02a32;--red-bg:#fff1f2}.shell{max-width:none;padding:0}main{padding:0!important}details::details-content{content-visibility:visible!important}details>*{display:block!important}pre{max-height:none;overflow:visible}.columns{grid-template-columns:1fr}.row{break-inside:avoid}}
</style></head><body><a class="skip" href="#overview">Skip to report</a>
<header><div class="shell bar"><a class="brand" href="#overview"><span class="mark" aria-hidden="true">↗</span>AutoPatch</a><span class="header-note">Migration review</span></div></header>
<main id="overview" class="shell"><div class="intro"><div class="intro-text"><span class="badge${verified ? "" : " blocked"}">${!verified ? "Blocked" : unchanged ? "No edits" : "Ready for review"}</span>
<h1>${title}</h1><p class="lead">${!verified ? "No writable patch. Resolve the findings below to continue." : unchanged ? "No source changes needed. The project passed the compiler check." : "The proposed edits pass TypeScript checks. Review them before applying."}</p></div>
${verified && !unchanged ? '<a class="button" href="#files">Review source edits <span aria-hidden="true">↓</span></a>' : ""}</div>
<div class="context"><span>Contract</span><code>${escape(basename(context.from))}</code><span aria-hidden="true">→</span><code>${escape(basename(context.to))}</code></div>
<dl class="stats"><div><dt>Schema changes</dt><dd>${result.changes.length}</dd></div><div><dt>Files to change</dt><dd>${result.files.length}</dd></div><div><dt>Compiler errors</dt><dd>${result.diagnostics.length}</dd></div><div><dt>AI repair rounds</dt><dd>${result.llmAttempts}</dd></div></dl>
<nav aria-label="Report sections"><a href="#changes">Schema changes</a><a href="#files">Source edits</a><a href="#verification">Verification</a></nav>
${findings}
<section id="changes"><div class="section-head"><h2>Schema changes</h2><span class="count">${result.changes.length}</span></div><div class="panel">
${result.changes.map((change, index) => `<details class="row"><summary><span class="tag">${changeLabel(change)}</span><span class="row-title">${escape(describe(change))}</span></summary><div class="detail">${evidence(index)}<details><summary>Schema contract</summary>${code(JSON.stringify(change, null, 2))}</details></div></details>`).join("") || '<p class="empty">No schema changes were recorded.</p>'}</div>
${result.changes.length ? '<p class="hint">Expand a change to inspect its contract and baseline symbol references.</p>' : ""}</section>
<section id="files"><div class="section-head"><h2>Source edits</h2><span class="count">${result.files.length}</span></div><div class="panel">
${result.files.map(file => `<details class="row"><summary><span class="row-title path">${local(file.path)}</span></summary><div class="detail columns"><div class="before"><div class="file-label">Before</div>${code(file.before)}</div><div class="after"><div class="file-label">After</div>${code(file.after)}</div></div></details>`).join("") || `<p class="empty">${verified ? "No source changes needed." : "No writable source edits."}</p>`}</div></section>
<section id="verification" class="verification"><h2>Verification</h2><p><strong>${verified ? "Baseline and proposed project: zero compiler errors." : "Verification did not complete successfully."}</strong></p>
<p>${result.llmAttempts === 0 ? "No LLM repair requests. Edits use deterministic AST transformations." : `${result.llmAttempts} LLM repair rounds with isolated call context. Individual edits are not attributed to a model response.`}</p>
<p class="muted">Type checking does not prove business correctness. Review behavior and run your application's tests.</p>
<details><summary>About this report</summary><p>This is a migration plan, not confirmation of a disk write or merged pull request. Check the CLI result for persistence status.</p><p>Locations refer to baseline source. Symbol references do not establish complete runtime data flow.</p><p>This report contains source code. Share it with the same access restrictions as the repository.</p></details></section>
<footer><span>AutoPatch · Generated locally</span><span>No remote assets or scripts</span></footer></main></body></html>`;
}
