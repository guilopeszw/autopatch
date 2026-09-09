import { Node, Project, ts, type FunctionDeclaration, type InterfaceDeclaration } from "ts-morph";
import { checkProject } from "../runner/type-checker.js";
import { assertRenameSafety } from "./rename-safety.js";
import type { SchemaChange } from "../diff/openapi-differ.js";

/** Explicit SDK binding: paths are absolute or relative to the project root. */
export interface SymbolBinding { file: string; export: string }
/** Explicit scalar values for newly required request fields; never inferred from OAS defaults. */
export interface SchemaBinding extends SymbolBinding { defaults?: Record<string, unknown> }
export interface Bindings {
  operations: Record<string, SymbolBinding>;
  schemas: Record<string, SchemaBinding>;
}

/** Resolve a concrete declaration; never guess an SDK binding from a shared name. */
export function resolveOperation(project: Project, binding: SymbolBinding): FunctionDeclaration {
  const source = project.getSourceFileOrThrow(binding.file);
  const declaration = source.getFunctionOrThrow(binding.export);
  if (!declaration.isExported() || source.isInNodeModules()) throw new Error(`Operation binding must be a local export: ${binding.export}`);
  return declaration;
}

function resolveSchema(project: Project, binding: SymbolBinding): InterfaceDeclaration {
  const source = project.getSourceFileOrThrow(binding.file);
  const declaration = source.getInterfaceOrThrow(binding.export);
  if (!declaration.isExported() || source.isInNodeModules()) throw new Error(`Schema binding must be a local interface export: ${binding.export}`);
  return declaration;
}

/**
 * Apply mechanical edits to the Project only. The runner owns snapshot rollback
 * and the zero-error save gate. Language-service renames update symbol references,
 * including imports, typed object literals and destructuring, rather than text.
 */
export function applyCodemods(project: Project, changes: readonly SchemaChange[], bindings: Bindings): void {
  for (const change of changes) {
    if (change.kind === "unsupported") throw new Error(`${change.location}: ${change.reason}`);
    if (change.kind === "operation-renamed") {
      const binding = bindings.operations[change.from];
      if (!binding) throw new Error(`Missing operation binding: ${change.from}`);
      const declaration = resolveOperation(project, binding);
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(change.to)) throw new Error(`Invalid TypeScript operation name: ${change.to}`);
      const sources = new Set([declaration.getSourceFile(), ...declaration.findReferencesAsNodes().map((node) => node.getSourceFile())]);
      // ponytail: reject name reuse anywhere in a referencing file; scope-aware
      // conflict analysis can relax this conservative rule when needed.
      for (const source of sources) {
        if (source.getDescendantsOfKind(ts.SyntaxKind.Identifier).some((node) => node.getText() === change.to)) {
          throw new Error(`Rename collision: ${change.to} already appears in ${source.getFilePath()}`);
        }
      }
      declaration.rename(change.to, { usePrefixAndSuffixText: true });
    } else if (change.kind === "property-renamed") {
      const binding = bindings.schemas[change.schema];
      if (!binding) throw new Error(`Missing schema binding: ${change.schema}`);
      const declaration = resolveSchema(project, binding);
      if (declaration.getType().getProperty(change.to)) throw new Error(`Property rename collision: ${change.to}`);
      const property = declaration.getPropertyOrThrow(change.from);
      if (!Node.isPropertySignature(property)) throw new Error(`Not a property: ${change.from}`);
      assertRenameSafety(property);
      property.rename(change.to, { usePrefixAndSuffixText: true });
    } else {
      const binding = bindings.schemas[change.schema];
      if (!binding) throw new Error(`Missing schema binding: ${change.schema}`);
      const declaration = resolveSchema(project, binding);
      const property = declaration.getProperty(change.property);
      if (change.before && !property) throw new Error(`Missing property: ${change.schema}.${change.property}`);
      if (!change.before && property) throw new Error(`Property already exists: ${change.schema}.${change.property}`);
      if (!change.after) {
        property?.remove();
      } else {
        const type = schemaType(change.after.schema);
        if (change.after.required && binding.defaults && Object.hasOwn(binding.defaults, change.property)) {
          insertConfiguredDefault(declaration, change.property, binding.defaults[change.property], change.after.schema);
        }
        if (property) {
          property.setType(type);
          property.setHasQuestionToken(!change.after.required);
        } else {
          declaration.addProperty({ name: JSON.stringify(change.property), type, hasQuestionToken: !change.after.required });
        }
      }
    }
  }
}

/**
 * Render a deliberately bounded OpenAPI schema into a compiler-parsed type node.
 * Unrepresentable constraints fail closed rather than disappearing into `any`.
 * JSON literals escape enum values; untrusted schema text is never used as code.
 */
function schemaType(schema: Record<string, unknown>): string {
  const allowed = new Set(["type", "enum", "nullable", "items"]);
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) throw new Error(`Unsupported property schema keyword: ${key}`);
  }
  if (schema.nullable !== undefined && typeof schema.nullable !== "boolean") throw new Error("nullable must be boolean");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length === 0) throw new Error("Schema type cannot be empty");
  const output = types.map((type): string => {
    if (type === "array") {
      if (!schema.items || typeof schema.items !== "object" || Array.isArray(schema.items)) throw new Error("Array schema requires items");
      return `(${schemaType(schema.items as Record<string, unknown>)})[]`;
    }
    if (type === "integer" || type === "number") return "number";
    if (type === "string" || type === "boolean" || type === "null") return type;
    throw new Error(`Unsupported property type: ${String(type)}`);
  });
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((value: unknown) =>
      value === null ? types.includes("null") || schema.nullable === true :
        (typeof value === "string" && types.includes("string")) ||
        (typeof value === "boolean" && types.includes("boolean")) ||
        (typeof value === "number" && Number.isFinite(value) &&
          (types.includes("number") || (types.includes("integer") && Number.isInteger(value)))))) {
      throw new Error("Enum values must match the declared scalar type");
    }
    return [...new Set([...schema.enum.map((value: unknown) => JSON.stringify(value)), ...(schema.nullable ? ["null"] : [])])].join(" | ");
  }
  return [...new Set([...output, ...(schema.nullable ? ["null"] : [])])].join(" | ");
}

/** Insert only into directly context-typed object literals, preserving existing fields. */
function insertConfiguredDefault(declaration: InterfaceDeclaration, name: string, value: unknown, schema: Record<string, unknown>): void {
  if (value !== null && typeof value !== "string" && typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`Configured default for ${name} must be a finite JSON scalar`);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  // TypeScript lowers OpenAPI integer to number, so validate this known literal
  // before lowering. A union explicitly allowing number still accepts fractions.
  if (typeof value === "number" && types.includes("integer") && !types.includes("number") && !Number.isInteger(value)) {
    throw new Error(`Configured default for ${name} must be an integer`);
  }
  const type = schemaType(schema);
  const literal = JSON.stringify(value);
  const validation = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  validation.createSourceFile("/default.ts", `const value: ${type} = ${literal};`);
  if (!checkProject(validation).success) throw new Error(`Configured default for ${name} does not satisfy ${type}`);
  const objects = declaration.getProject().getSourceFiles().filter((source) => !source.isInNodeModules())
    .flatMap((source) => source.getDescendantsOfKind(ts.SyntaxKind.ObjectLiteralExpression))
    .filter((object) => object.getContextualType()?.getSymbol()?.getDeclarations()
      .some((node) => node.compilerNode === declaration.compilerNode));
  for (const object of objects) {
    if (object.getType().getProperty(name)) continue;
    if (object.getProperties().some(Node.isSpreadAssignment)) throw new Error(`Cannot infer missing ${name} through a spread`);
    // Literal keys have known names (including our own generated assignments).
    // ponytail: block broader computed key types; finite-union analysis can relax
    // this conservative guard when a real migration requires it.
    if (object.getProperties().some((member) => {
      const key = member.getFirstChildByKind(ts.SyntaxKind.ComputedPropertyName)?.getExpression().getType();
      return key && !key.isStringLiteral() && !key.isNumberLiteral();
    })) {
      throw new Error(`Cannot infer missing ${name} through a computed property`);
    }
    // Computed keys preserve JSON semantics even for a key named __proto__.
    object.addPropertyAssignment({ name: `[${JSON.stringify(name)}]`, initializer: literal });
  }
}
