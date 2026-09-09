import {
  Node,
  type CallExpression,
  type FunctionDeclaration,
  type MethodDeclaration,
  type MethodSignature,
  type PropertyDeclaration,
  type PropertySignature,
  type VariableDeclaration,
} from "ts-morph";

/** Named declarations whose references can identify an API invocation. */
export type CallableDeclaration =
  | FunctionDeclaration
  | MethodDeclaration
  | MethodSignature
  | PropertyDeclaration
  | PropertySignature
  | VariableDeclaration;

/**
 * Find direct invocations of a declaration within its loaded ts-morph Project.
 *
 * TypeScript's language service follows symbol references across imports and
 * import aliases. Matching the callee position excludes reads, callback arguments,
 * and unrelated declarations that merely share the same name. Results are live
 * AST nodes suitable for downstream codemods, ordered by file path then offset.
 * This function neither mutates source text nor writes to disk.
 *
 * The caller must load the target project's sources and module-resolution options
 * before discovery. Missing dependencies can hide references; compiler validation
 * belongs at the runner boundary. Nodes must be rediscovered after AST edits that
 * invalidate them.
 *
 * ponytail: symbol references cover direct calls, not runtime data flow through
 * assigned callbacks, bind/call/apply, or computed member names. Add explicit
 * data-flow analysis if those invocation forms become a supported migration case.
 *
 * @param declaration The actual API declaration, not a name to search as text.
 * @returns Unique call expressions; an unused declaration yields an empty array.
 */
export function findCallSites(
  declaration: CallableDeclaration,
): CallExpression[] {
  const calls = new Set<CallExpression>();

  for (const reference of declaration.findReferencesAsNodes()) {
    let callee: Node = reference;
    const parent = callee.getParent();

    // A property reference is callable only when it names the member, not when
    // it is the receiver: api.getUser() calls getUser, not api.
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === callee) {
      callee = parent;
    }

    const call = callee.getParent();
    if (Node.isCallExpression(call) && call.getExpression() === callee) {
      calls.add(call);
    }
  }

  return [...calls].sort((left, right) => {
    const leftPath = left.getSourceFile().getFilePath();
    const rightPath = right.getSourceFile().getFilePath();
    // Explicit lexical ordering avoids dependence on the machine's locale.
    if (leftPath !== rightPath) return leftPath < rightPath ? -1 : 1;
    return left.getStart() - right.getStart();
  });
}
