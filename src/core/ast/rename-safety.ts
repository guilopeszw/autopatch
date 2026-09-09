import { Node, ts, type PropertySignature, type Type } from "ts-morph";

/**
 * Optional structural fields can survive a rename without a compiler error.
 * Inspect contextual assignment boundaries (arguments, returns, initializers,
 * callback signatures and containers) before mutating the symbol. Every producer
 * of the old field must already be covered by the language-service rename.
 *
 * This is a conservative proof over static types, not runtime data-flow analysis.
 * Unproven producers and any-valued flows are blocked, never silently accepted.
 * ponytail: scan loaded ASTs per renamed field; cache a flow graph if large SDK
 * migrations make this scan a measured bottleneck.
 */
export function assertRenameSafety(property: PropertySignature): void {
  const project = property.getProject();
  const checker = project.getTypeChecker();
  const name = property.getName();
  const declaration = property.compilerNode;
  const covered = new Set([property.getNameNode().compilerNode,
    ...property.findReferencesAsNodes().map((node) => node.compilerNode)]);

  for (const source of project.getSourceFiles()) {
    if (source.isInNodeModules()) continue;
    for (const expression of source.getDescendants()) {
      if (!Node.isExpression(expression)) continue;
      const contextual = checker.getContextualType(expression);
      if (!contextual) continue;
      const visited = new Map<ts.Type, Set<ts.Type>>();
      const inspect = (expected: Type, actual: Type): void => {
        if (expected.compilerType === actual.compilerType) return;
        const seen = visited.get(expected.compilerType) ?? new Set<ts.Type>();
        if (seen.has(actual.compilerType)) return;
        seen.add(actual.compilerType);
        visited.set(expected.compilerType, seen);
        const expectedProperty = expected.getProperty(name);
        if (expectedProperty?.getDeclarations().some((node) => node.compilerNode === declaration)) {
          const actualProperty = actual.getProperty(name);
          const declarations = actualProperty?.getDeclarations() ?? [];
          if (actual.isAny() || (actualProperty && (declarations.length === 0 || declarations.some((node) => {
            const nameNode = Node.hasName(node) ? node.getNameNode() : undefined;
            return node.compilerNode !== declaration && (!nameNode || !covered.has(nameNode.compilerNode));
          })))) {
            throw new Error(`Unproven structural rename flow for ${name} at ${source.getFilePath()}:${expression.getStartLineNumber()}; annotate the producer with the bound interface`);
          }
        }
        if (expected.isUnion() || expected.isIntersection()) {
          for (const member of [...expected.getUnionTypes(), ...expected.getIntersectionTypes()]) inspect(member, actual);
          return;
        }
        if (actual.isUnion() || actual.isIntersection()) {
          for (const member of [...actual.getUnionTypes(), ...actual.getIntersectionTypes()]) inspect(expected, member);
          return;
        }
        const element = expected.getArrayElementType();
        if (element) {
          const actualElement = actual.getArrayElementType();
          if (actualElement) inspect(element, actualElement);
          else if (actual.isAny()) inspect(element, actual);
          else for (const member of actual.getTupleElements()) inspect(element, member);
          return;
        }
        if (expected.isTuple()) {
          expected.getTupleElements().forEach((member, index) => {
            const other = actual.getTupleElements()[index] ?? actual.getArrayElementType();
            if (other) inspect(member, other);
            else if (actual.isAny()) inspect(member, actual);
          });
          return;
        }
        if (expected.getFlags() & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike |
          ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return;
        for (const index of [expected.getStringIndexType(), expected.getNumberIndexType()]) {
          if (!index) continue;
          const actualIndex = actual.getStringIndexType() ?? actual.getNumberIndexType();
          if (actualIndex) inspect(index, actualIndex);
          if (actual.isAny()) inspect(index, actual);
          // An inferred object often has concrete keys rather than an index
          // signature. Those values still flow into Record<string, Input>.
          for (const field of actual.getProperties()) inspect(index, field.getTypeAtLocation(expression));
        }
        for (const field of expected.getProperties()) {
          const other = actual.getProperty(field.getName());
          if (other || actual.isAny()) inspect(field.getTypeAtLocation(expression), other?.getTypeAtLocation(expression) ?? actual);
        }
        for (const signature of expected.getCallSignatures()) {
          if (actual.isAny()) inspect(signature.getReturnType(), actual);
          for (const other of actual.getCallSignatures()) {
            inspect(signature.getReturnType(), other.getReturnType());
            signature.getParameters().forEach((parameter, index) => {
              const otherParameter = other.getParameters()[index];
              if (otherParameter) inspect(parameter.getTypeAtLocation(expression), otherParameter.getTypeAtLocation(expression));
            });
          }
        }
      };
      inspect(contextual, expression.getType());
    }
  }
}
