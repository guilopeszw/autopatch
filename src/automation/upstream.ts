import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseDocument } from "yaml";

export interface Source { repository: string; ref: string; path: string }
export type SchemaScope = Record<string, "*" | string[]>;
/** Valid upstream change that needs a person to revise the configured scope. */
export class ScopeChangeError extends Error {}
export interface Snapshot { revision: string; url: string; sha256: string; text: string; document: unknown }

/** Reject malformed configuration/data rather than treating it as an empty contract. */
export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

/** Stable JSON for snapshots and content-based delivery identities; rejects YAML cycles and non-JSON values. */
export function stableJson(value: unknown): string {
  const normalize = (item: unknown, depth: number): unknown => {
    if (depth > 100) throw new Error("Contract exceeds maximum nesting depth");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(child => normalize(child, depth + 1));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, normalize(child, depth + 1)]));
    throw new Error("Contract contains a non-JSON value");
  };
  return `${JSON.stringify(normalize(value, 0), null, 2)}\n`;
}
export const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Public GitHub only: resolve a ref once, then download exactly that immutable revision without credentials. */
export async function fetchSnapshot(source: Source, fetcher: typeof fetch): Promise<Snapshot> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(source.repository) || !source.ref || source.ref.length > 200 ||
      !/^[\w./-]+\.(json|ya?ml)$/.test(source.path) || source.path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Source must identify a GitHub repository, ref, and JSON/YAML file path");
  }
  const commit = object(JSON.parse(await download(`https://api.github.com/repos/${source.repository}/commits/${encodeURIComponent(source.ref)}`, fetcher, 1_000_000)), "GitHub commit");
  if (typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("GitHub did not return an immutable commit SHA");
  const url = `https://raw.githubusercontent.com/${source.repository}/${commit.sha}/${source.path}`;
  const text = await download(url, fetcher, 25_000_000);
  let document: unknown;
  if (source.path.endsWith(".json")) document = JSON.parse(text) as unknown;
  else {
    const yaml = parseDocument(text, { strict: true, uniqueKeys: true, stringKeys: true, version: "1.2", merge: false });
    if (yaml.errors.length || yaml.warnings.length) throw new Error("Upstream YAML has parse errors or unsupported tags");
    document = yaml.toJS({ maxAliasCount: 50 }) as unknown;
  }
  // Validate JSON compatibility before traversing any potentially aliased YAML.
  stableJson(document);
  return { revision: commit.sha, url, sha256: digest(text), text, document };
}

async function download(url: string, fetcher: typeof fetch, maxBytes: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Accept: "application/json, application/yaml, text/plain", "User-Agent": "AutoPatch" } });
    } catch {
      if (attempt === 2) throw new Error("Provider request failed after 3 attempts");
      await delay(250 * 2 ** attempt); continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await response.body?.cancel(); await delay(250 * 2 ** attempt); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider request failed (HTTP ${response.status})`); }
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Provider response exceeds size limit"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Provider response has no body");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error("Provider response exceeds size limit");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  }
}

/**
 * Monitor explicitly selected schema fields, preserving their complete property
 * definitions and schema-level constraints. Follow local schema references, never
 * remote references. Endpoint/transport changes and unselected fields are outside
 * this declared scope. Stripe expansion annotations describe excluded fields.
 */
export function projectContract(upstream: unknown, baseline: unknown, scope: SchemaScope): unknown {
  const source = object(upstream, "OpenAPI document");
  if (typeof source.openapi !== "string" || !/^3\.[01]\.\d+$/.test(source.openapi)) throw new Error("Only OpenAPI 3.0/3.1 sources are supported");
  const schemas = object(object(source.components, "components").schemas, "schemas");
  const prior = object(baseline, "baseline");
  const selected = new Map<string, unknown>();
  for (const [name, fields] of Object.entries(scope)) {
    if (!Object.hasOwn(schemas, name)) throw new ScopeChangeError(`Monitored schema is missing: ${name}`);
    const schema = object(schemas[name], name);
    if (fields === "*") { selected.set(name, schema); continue; }
    if (schema.type !== "object") throw new ScopeChangeError(`Monitored schema is no longer an object: ${name}`);
    const properties = object(schema.properties, `${name}.properties`);
    if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every(item => typeof item === "string"))) throw new Error(`Invalid required list: ${name}`);
    selected.set(name, {
      ...Object.fromEntries(Object.entries(schema).filter(([key]) => !["properties", "required", "x-expandableFields", "x-resourceId"].includes(key))),
      properties: Object.fromEntries(fields.filter(field => Object.hasOwn(properties, field)).map(field => [field, properties[field]])),
      ...(schema.required === undefined ? {} : { required: (schema.required as string[]).filter(field => fields.includes(field)) }),
    });
  }
  // A growing Map lets us visit transitive dependencies once, including cycles of $refs.
  for (const value of selected.values()) {
    const visit = (item: unknown): void => {
      if (!item || typeof item !== "object") return;
      for (const [key, child] of Object.entries(item)) {
        if (key === "$ref") {
          if (typeof child !== "string" || !/^#\/components\/schemas\/[^/]+$/.test(child)) throw new Error("Only local schema references are supported by monitoring");
          const name = child.slice("#/components/schemas/".length).replace(/~1/g, "/").replace(/~0/g, "~");
          if (!Object.hasOwn(schemas, name)) throw new Error(`Unresolved schema reference: ${name}`);
          if (!selected.has(name)) selected.set(name, schemas[name]);
          if (selected.size > 100) throw new Error("Monitored scope exceeds 100 schemas");
        } else visit(child);
      }
    };
    visit(value);
  }
  return { openapi: source.openapi, info: prior.info, paths: {}, components: { schemas: Object.fromEntries(selected) } };
}
