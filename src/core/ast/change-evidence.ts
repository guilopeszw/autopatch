import { Node, type Project } from "ts-morph";
import { resolveOperation, type Bindings } from "./codemod-builder.js";
import { findCallSites } from "./callsite-finder.js";
import type { SchemaChange } from "../diff/openapi-differ.js";

export interface SourceEvidence { path: string; line: number; snippet: string }
export interface ChangeEvidence {
  changeIndex: number;
  symbol: string;
  declaration: SourceEvidence;
  references: SourceEvidence[];
}

/**
 * Snapshot baseline symbol locations before AST edits invalidate nodes. Operation
 * evidence contains direct calls; property evidence contains language-service
 * references, which are not a claim of complete runtime data-flow analysis.
 */
export function collectChangeEvidence(project: Project, changes: readonly SchemaChange[], bindings: Bindings): ChangeEvidence[] {
  const location = (node: Node): SourceEvidence => ({
    path: node.getSourceFile().getFilePath(), line: node.getStartLineNumber(), snippet: node.getText(),
  });
  return changes.flatMap((change, changeIndex): ChangeEvidence[] => {
    if (change.kind === "unsupported") return [];
    if (change.kind === "operation-renamed") {
      const binding = bindings.operations[change.from];
      if (!binding) return [];
      const declaration = resolveOperation(project, binding);
      return [{ changeIndex, symbol: binding.export, declaration: location(declaration), references: findCallSites(declaration).map(location) }];
    }
    const binding = bindings.schemas[change.schema];
    if (!binding) return [];
    const schema = project.getSourceFileOrThrow(binding.file).getInterfaceOrThrow(binding.export);
    const name = change.kind === "property-renamed" ? change.from : change.property;
    const property = schema.getProperty(name);
    const declaration = property ?? schema;
    const references = declaration.findReferencesAsNodes().map(node => {
      const parent = node.getParent();
      return location(Node.isPropertyAccessExpression(parent) ? parent : node);
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line);
    return [{ changeIndex, symbol: `${binding.export}.${name}`, declaration: location(declaration), references }];
  });
}
