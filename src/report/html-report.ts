import { basename, relative } from "node:path";
import type { MigrationResult } from "../core/runner/migration.js";

/**
 * Render a self-contained, inert review artifact. Every dynamic value is escaped;
 * no source, model output, script, font, or remote asset is executed or fetched.
 * The document describes a plan, not whether that plan was persisted afterward.
 */
export function renderHtmlReport(result: MigrationResult, context: { root: string; from: string; to: string }): string {
  const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const code = (text: string): string => `<pre tabindex="0"><code>${escape(text)}</code></pre>`;
  const local = (path: string): string => escape(relative(context.root, path) || basename(path));
  const verified = result.status === "verified";
  const title = verified ? "Verified migration plan" : "Migration blocked";
  const describe = (change: MigrationResult["changes"][number]): string => {
    if (change.kind === "operation-renamed") return `${change.from} → ${change.to}`;
    if (change.kind === "property-renamed") return `${change.schema}.${change.from} → ${change.to}`;
    if (change.kind === "unsupported") return `${change.location}: ${change.reason}`;
    return `${change.schema}.${change.property} ${!change.after ? "was removed" : !change.before ? "was added" : "changed its type or requiredness"}`;
  };
  const evidence = (index: number): string => result.evidence.filter(item => item.changeIndex === index).map(item =>
    `<div class="card"><h3>Bound symbol: <code>${escape(item.symbol)}</code></h3><p class="path">${local(item.declaration.path)}:${item.declaration.line}</p>
    <details><summary>Baseline declaration</summary>${code(item.declaration.snippet)}</details>
    <h3>Baseline references / direct calls</h3>${item.references.map(reference => `<p class="path">${local(reference.path)}:${reference.line}</p>${code(reference.snippet)}`).join("") || '<p>No baseline references found.</p>'}</div>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title} · AutoPatch</title>
<style>
:root{color-scheme:light;--ink:#192c30;--muted:#536568;--line:#d7dfdb;--paper:#f5f6f2;--green:#17634e;--red:#9b342c}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 system-ui,-apple-system,sans-serif}
a{color:inherit;text-underline-offset:4px}a:focus-visible,summary:focus-visible,pre:focus-visible{outline:3px solid #bc640e;outline-offset:4px}
.skip{position:absolute;left:12px;top:-100px;background:white;padding:12px;z-index:2}.skip:focus{top:12px}
aside{position:fixed;inset:0 auto 0 0;width:238px;padding:36px 28px;background:#152e31;color:#e3efeb;display:flex;flex-direction:column}
.brand{font-size:23px;font-weight:750;letter-spacing:-1px}.brand span{color:#a8d3b9}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:750}
aside .eyebrow{color:#a8beb7;margin-top:8px}nav{margin-top:64px;display:grid;gap:18px}nav a{text-decoration:none;font-size:14px}nav a:hover{text-decoration:underline}
.aside-note{margin-top:auto;color:#abc0b9;font-size:12px}main{margin-left:238px;padding:48px clamp(24px,5vw,80px);max-width:1600px}
.top{display:flex;justify-content:space-between;gap:16px;align-items:center;color:var(--muted);font-size:12px;border-bottom:1px solid var(--line);padding-bottom:22px}
.badge{display:inline-block;border:1px solid currentColor;border-radius:4px;padding:4px 9px;color:${verified ? "var(--green)" : "var(--red)"};font-weight:700}
h1{font-size:clamp(32px,4vw,52px);line-height:1.12;letter-spacing:-.045em;max-width:760px;margin:26px 0 18px}h2{font-size:24px;letter-spacing:-.025em;margin:0}h3{font-size:16px;margin:0 0 12px}
.lead{color:var(--muted);max-width:760px;margin-bottom:30px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);background:white;margin:32px 0 44px}
.metric{padding:24px;border-right:1px solid var(--line)}.metric:last-child{border:0}.metric strong{display:block;font-size:32px;line-height:1.2;font-weight:600}.metric span{font-size:12px;color:var(--muted)}
section{margin:42px 0}.section-head{display:flex;align-items:baseline;gap:14px;margin-bottom:20px}.section-head span{font:12px ui-monospace,monospace;color:var(--muted)}
.card{border:1px solid var(--line);background:white;padding:22px;margin:14px 0;border-radius:6px}.change-kind{color:var(--green);font:12px ui-monospace,monospace;margin-bottom:12px}
pre{background:#f3f5f3;padding:16px;overflow:auto;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;margin:12px 0 0;border-radius:3px}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;margin-top:18px}.columns pre{max-height:620px}.file-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
summary{cursor:pointer;font-weight:650;overflow-wrap:anywhere}.notice{border-left:3px solid ${verified ? "var(--green)" : "var(--red)"};padding:8px 20px;background:#edf1eb}.notice p{margin:6px 0}
li{margin:8px 0}footer{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding:24px 0}.path{overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:12px}
@media(max-width:850px){aside{position:static;width:auto;padding:20px 24px}aside .eyebrow,.aside-note{display:none}nav{margin-top:18px;display:flex;flex-wrap:wrap;gap:18px}main{margin:0;padding:24px}.metrics{grid-template-columns:repeat(2,1fr)}.metric{border-bottom:1px solid var(--line)}.columns{grid-template-columns:1fr}.top{align-items:flex-start}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{aside,.skip{display:none}main{margin:0;padding:0}pre,.columns pre{max-height:none;white-space:pre-wrap;overflow-wrap:anywhere}.card{break-inside:avoid}.metrics{margin:20px 0}}
</style></head><body><a class="skip" href="#overview">Skip to report</a>
<aside><div class="brand">auto<span>patch</span></div><div class="eyebrow">Migration review</div><nav aria-label="Report sections"><a href="#overview">01 &nbsp; Overview</a><a href="#changes">02 &nbsp; Schema changes</a><a href="#files">03 &nbsp; Source edits</a><a href="#verification">04 &nbsp; Verification</a></nav><p class="aside-note">AST transformations.<br>Compiler-gated patches.<br>Evidence you can inspect.</p></aside>
<main id="overview"><div class="top"><span class="eyebrow">API evolution / Review artifact</span><span class="badge">${verified ? "VERIFIED PLAN" : "BLOCKED"}</span></div>
<h1>${title}</h1><p class="lead">${verified ? "The proposed changes passed the in-memory TypeScript compiler gate. Review the contract changes and source edits below." : "AutoPatch could not establish a compiler-valid migration. There is no writable patch; the findings below explain what needs attention."}</p>
<p class="path">${escape(basename(context.from))} → ${escape(basename(context.to))}</p>
<div class="metrics"><div class="metric"><strong>${result.changes.length}</strong><span>Schema changes</span></div><div class="metric"><strong>${result.files.length}</strong><span>Files in verified plan</span></div><div class="metric"><strong>${result.diagnostics.length}</strong><span>Reported compiler errors</span></div><div class="metric"><strong>${result.llmAttempts}</strong><span>LLM repair rounds</span></div></div>
<section id="changes"><div class="section-head"><span>02</span><h2>Schema changes</h2></div>
${result.changes.map((change, index) => `<article class="card"><div class="change-kind">CHANGE ${String(index + 1).padStart(2, "0")} / ${escape(change.kind)}</div><h3>${escape(describe(change))}</h3><details><summary>Inspect schema contract</summary>${code(JSON.stringify(change, null, 2))}</details>${evidence(index)}</article>`).join("") || '<p>No schema changes were recorded.</p>'}<p>Locations refer to the baseline source. Symbol references do not establish complete runtime data flow.</p></section>
<section id="files"><div class="section-head"><span>03</span><h2>Source edits</h2></div><p>Exact source before and after the proposed migration.</p>
${result.files.map(file => `<details class="card" open><summary>${local(file.path)}</summary><div class="columns"><div><div class="file-label">Before</div>${code(file.before)}</div><div><div class="file-label">After</div>${code(file.after)}</div></div></details>`).join("") || '<p>No writable source edits.</p>'}</section>
<section id="verification"><div class="section-head"><span>04</span><h2>Verification &amp; limits</h2></div><div class="notice"><p><strong>${verified ? "Baseline and proposed project: zero compiler errors." : "Verification did not complete successfully."}</strong></p><p>${result.llmAttempts === 0 ? "No LLM repair requests. Mechanical edits use deterministic AST transformations." : `${result.llmAttempts} LLM repair rounds were attempted with isolated callsite context. This report does not attribute individual edits to a particular model response.`}</p></div>
${result.issues.length ? `<h3>Blocking findings</h3><ul>${result.issues.map(issue => `<li>${escape(issue)}</li>`).join("")}</ul>` : ""}
${result.diagnostics.map(error => `<article class="card"><h3>TS${error.code}</h3><p class="path">${error.file ? local(error.file) : "project"}:${error.line ?? 0}</p>${code(error.message)}</article>`).join("")}
<p>Type checking does not prove business correctness. Review behavior, runtime validation, and unsupported API contracts separately.</p><p>This artifact records a migration plan, not confirmation of a disk write or a merged pull request. It contains source code; share it with the same care as the repository.</p></section>
<footer>AutoPatch · Generated locally · No remote assets or scripts</footer></main></body></html>`;
}
