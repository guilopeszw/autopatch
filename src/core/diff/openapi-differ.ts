/** Supported operations are deliberately explicit; this is not a full OAS validator. */
const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
type ObjectValue = Record<string, unknown>;

export interface PropertyContract {
  schema: Record<string, unknown>;
  required: boolean;
}

export type SchemaChange =
  | { kind: "unsupported"; location: string; reason: string }
  | { kind: "operation-renamed"; method: string; path: string; from: string; to: string }
  | { kind: "property-renamed"; schema: string; from: string; to: string }
  | { kind: "property-updated"; schema: string; property: string; before?: PropertyContract; after?: PropertyContract };

/** Reject malformed input at the JSON boundary instead of coercing it to an empty schema. */
function object(value: unknown, location: string): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as ObjectValue;
}

function document(value: unknown): ObjectValue {
  const result = object(value, "OpenAPI document");
  if (typeof result.openapi !== "string" || !/^3\.[01]\.\d+$/.test(result.openapi)) {
    throw new Error("Only OpenAPI 3.0.x and 3.1.x JSON documents are supported");
  }
  object(result.info, "info");
  const paths = object(result.paths, "paths");
  const ids = new Set<string>();
  for (const [path, value] of Object.entries(paths)) {
    if (!path.startsWith("/")) throw new Error(`Invalid OpenAPI path: ${path}`);
    const item = object(value, path);
    for (const method of methods) {
      if (!Object.hasOwn(item, method)) continue;
      const operation = object(item[method], `${method} ${path}`);
      if (operation.operationId === undefined) continue;
      if (typeof operation.operationId !== "string" || !operation.operationId || ids.has(operation.operationId)) {
        throw new Error(`Invalid or duplicate operationId at ${method} ${path}`);
      }
      ids.add(operation.operationId);
    }
  }
  return result;
}

function schemas(doc: ObjectValue): ObjectValue {
  return object(object(doc.components ?? {}, "components").schemas ?? {}, "components.schemas");
}

/**
 * Match operations by HTTP method and path, never by name similarity.
 * Property renames require x-autopatch-previous-name on the destination field.
 * Stable key traversal produces the same plan regardless of JSON member order.
 */
export function diffOpenApi(before: unknown, after: unknown): SchemaChange[] {
  const oldDoc = document(before);
  const newDoc = document(after);
  const changes: SchemaChange[] = [];
  const unsupported = (location: string, reason: string) => changes.push({ kind: "unsupported", location, reason });
  if (canonical(omit(oldDoc, ["openapi", "info", "paths", "components", "tags", "externalDocs", ...metadata])) !==
      canonical(omit(newDoc, ["openapi", "info", "paths", "components", "tags", "externalDocs", ...metadata]))) {
    unsupported("document", "Top-level runtime contract changed (for example servers or security)");
  }
  if (canonical(omit(object(oldDoc.components ?? {}, "components"), ["schemas"])) !==
      canonical(omit(object(newDoc.components ?? {}, "components"), ["schemas"]))) {
    unsupported("components", "Non-schema components changed");
  }
  const oldPaths = object(oldDoc.paths, "paths");
  const newPaths = object(newDoc.paths, "paths");
  for (const path of [...new Set([...Object.keys(oldPaths), ...Object.keys(newPaths)])].sort()) {
    const oldPath = object(oldPaths[path] ?? {}, `paths.${path}`);
    const newPath = object(newPaths[path] ?? {}, `paths.${path}`);
    if (canonical(omit(oldPath, [...methods, ...metadata])) !== canonical(omit(newPath, [...methods, ...metadata]))) {
      unsupported(path, "Path-level contract changed");
    }
    for (const method of methods) {
      if (!Object.hasOwn(oldPath, method) && !Object.hasOwn(newPath, method)) continue;
      if (!Object.hasOwn(oldPath, method) || !Object.hasOwn(newPath, method)) {
        unsupported(`${method} ${path}`, "Operation added or removed; no SDK generation or deletion is inferred");
        continue;
      }
      const oldOperation = object(oldPath[method], `${method} ${path}`);
      const newOperation = object(newPath[method], `${method} ${path}`);
      if (canonical(omit(oldOperation, ["operationId", ...metadata])) !== canonical(omit(newOperation, ["operationId", ...metadata]))) {
        unsupported(`${method} ${path}`, "Operation contract changed beyond its operationId");
      }
      if (oldOperation.operationId !== newOperation.operationId &&
          (typeof oldOperation.operationId !== "string" || typeof newOperation.operationId !== "string")) {
        unsupported(`${method} ${path}`, "Operation identity was added or removed");
      }
      if (typeof oldOperation.operationId === "string" && typeof newOperation.operationId === "string"
          && oldOperation.operationId !== newOperation.operationId) {
        changes.push({ kind: "operation-renamed", method, path, from: oldOperation.operationId, to: newOperation.operationId });
      }
    }
  }
  const oldSchemas = schemas(oldDoc);
  const newSchemas = schemas(newDoc);
  for (const schema of [...new Set([...Object.keys(oldSchemas), ...Object.keys(newSchemas)])].sort()) {
    if (!Object.hasOwn(oldSchemas, schema) || !Object.hasOwn(newSchemas, schema)) {
      unsupported(schema, "Schema added or removed; explicit SDK binding migration is required");
      continue;
    }
    const oldSchema = object(oldSchemas[schema], schema);
    const newSchema = object(newSchemas[schema] ?? {}, schema);
    if (canonical(oldSchema) === canonical(newSchema)) continue;
    if ((oldSchema.type !== undefined && oldSchema.type !== "object") ||
        (newSchema.type !== undefined && newSchema.type !== "object") ||
        ["allOf", "oneOf", "anyOf", "$ref"].some((key) => key in oldSchema || key in newSchema) ||
        canonical(schemaConstraints(oldSchema)) !== canonical(schemaConstraints(newSchema))) {
      unsupported(schema, "Only direct object properties can be migrated; schema-level constraints changed");
      continue;
    }
    const oldProperties = object(oldSchema.properties ?? {}, `${schema}.properties`);
    const newProperties = object(newSchema.properties ?? {}, `${schema}.properties`);
    const oldRequired = required(oldSchema);
    const newRequired = required(newSchema);
    const renamed = new Map<string, string>();
    for (const to of Object.keys(newProperties).sort()) {
      const from = object(newProperties[to], `${schema}.${to}`)["x-autopatch-previous-name"];
      if (from !== undefined && (typeof from !== "string" || from.length === 0)) {
        throw new Error(`Invalid rename hint for ${schema}.${to}`);
      }
      if (typeof from === "string" && from !== to && !Object.hasOwn(oldProperties, to) && !Object.hasOwn(oldProperties, from)) {
        throw new Error(`Missing rename source ${schema}.${from}`);
      }
      if (typeof from === "string" && from !== to && Object.hasOwn(oldProperties, from)) {
        if (Object.hasOwn(oldProperties, to) || Object.hasOwn(newProperties, from) || renamed.has(from)) {
          throw new Error(`Ambiguous rename ${schema}.${from} -> ${to}`);
        }
        changes.push({ kind: "property-renamed", schema, from, to });
        renamed.set(from, to);
      }
    }
    const names = new Set([...Object.keys(oldProperties).map((name) => renamed.get(name) ?? name), ...Object.keys(newProperties)]);
    for (const property of [...names].sort()) {
      const oldName = [...renamed].find(([, to]) => to === property)?.[0] ?? property;
      const before = Object.hasOwn(oldProperties, oldName)
        ? { schema: omit(object(oldProperties[oldName], oldName), metadata), required: oldRequired.has(oldName) } : undefined;
      const after = Object.hasOwn(newProperties, property)
        ? { schema: omit(object(newProperties[property], property), metadata), required: newRequired.has(property) } : undefined;
      if (canonical(before) !== canonical(after)) {
        changes.push({ kind: "property-updated", schema, property, ...(before ? { before } : {}), ...(after ? { after } : {}) });
      }
    }
  }
  return changes;
}

const metadata = ["description", "title", "example", "examples", "deprecated", "x-autopatch-previous-name"];
/** Normalize the default only for plain objects; other keywords can depend on evaluated-property annotations. */
function schemaConstraints(schema: ObjectValue): ObjectValue {
  const plain = Object.keys(schema).every(key => ["type", "properties", "required", "additionalProperties", ...metadata].includes(key));
  return omit(schema, ["properties", "required", ...metadata, ...(plain && schema.additionalProperties === true ? ["additionalProperties"] : [])]);
}
function omit(value: ObjectValue, keys: readonly string[]): ObjectValue {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/** JSON object order is insignificant; array order is preserved conservatively. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function required(schema: ObjectValue): Set<string> {
  const names = schema.required ?? [];
  if (!Array.isArray(names) || !names.every((name): name is string => typeof name === "string")) {
    throw new Error("Schema required must be an array of property names");
  }
  const properties = object(schema.properties ?? {}, "properties");
  if (names.some((name) => !Object.hasOwn(properties, name))) {
    throw new Error("Required property has no direct schema definition");
  }
  return new Set(names);
}
