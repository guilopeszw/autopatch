import { Node, Project, ts, type CallExpression } from "ts-morph";
import type { SchemaChange } from "../diff/openapi-differ.js";
import { checkProject, type CompilerError } from "../runner/type-checker.js";

/** This is the complete dynamic model context: no files, credentials or unrelated diagnostics. */
export interface RepairRequest { snippet: string; changes: readonly SchemaChange[] }
export type RepairTransport = (request: RepairRequest, signal: AbortSignal) => Promise<string>;
export interface RepairOptions { maxAttempts?: number; timeoutMs?: number }
export interface RepairResult { success: boolean; attempts: number; diagnostics: CompilerError[]; issues: string[] }

/**
 * Repair a batch of affected calls, then validate the complete in-memory program.
 * A batch permits multiple interdependent broken calls to be fixed together.
 * Every failed round restores its sources before retrying. Accepted AST edits
 * remain staged for the runner's final gate; this function never saves files.
 */
export async function repairCallSites(
  project: Project, calls: readonly CallExpression[], changes: readonly SchemaChange[],
  transport: RepairTransport, options: RepairOptions = {},
): Promise<RepairResult> {
  const maxAttempts = options.maxAttempts ?? 2;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error("maxAttempts must be between 1 and 5");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("timeoutMs must be between 1 and 120000");
  const targets = calls.map((call) => ({ source: call.getSourceFile(), start: call.getStart(), end: call.getEnd(), snippet: call.getText(), callee: call.getExpression().getText() }));
  if (JSON.stringify(changes).length > 64_000 || targets.some((target) => target.snippet.length > 16_000)) {
    throw new Error("LLM context exceeds the isolated snippet/diff size limit");
  }
  const originals = new Map(targets.map(({ source }) => [source, source.getFullText()]));
  const restore = () => { for (const [source, text] of originals) if (source.getFullText() !== text) source.replaceWithText(text); };
  const result: RepairResult = { success: false, attempts: 0, diagnostics: checkProject(project).errors, issues: [] };
  if (targets.length === 0) return result;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result.attempts = attempt;
    try {
      const replacements = [];
      for (const target of targets) {
        const signal = AbortSignal.timeout(timeoutMs);
        const replacement = await Promise.race([
          transport({ snippet: target.snippet, changes }, signal),
          new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("LLM request timed out")), { once: true })),
        ]);
        validateReplacement(replacement, target.callee);
        replacements.push({ ...target, replacement });
      }
      // Work backwards so a later edit cannot shift an earlier node's offsets.
      replacements.sort((a, b) => b.start - a.start);
      for (const target of replacements) {
        const call = target.source.getDescendantsOfKind(ts.SyntaxKind.CallExpression)
          .find((node) => node.getStart() === target.start && node.getEnd() === target.end);
        if (!call) throw new Error("Repair target became stale or overlaps another target");
        call.replaceWithText(target.replacement);
      }
      const validation = checkProject(project);
      result.diagnostics = validation.errors;
      if (validation.success) {
        result.success = true;
        result.issues = [];
        return result;
      }
    } catch (error) {
      result.issues = [error instanceof Error ? error.message : String(error)];
    }
    restore();
  }
  if (!result.issues.length) result.issues.push("LLM repair exhausted its attempts without a zero-error program");
  return result;
}

/** Parse untrusted model output as one call expression, never as a source file edit. */
function validateReplacement(text: string, callee: string): void {
  if (typeof text !== "string" || text.length > 16_000 || text.includes("@ts-")) throw new Error("Invalid or oversized LLM output");
  const parser = new Project({ useInMemoryFileSystem: true, compilerOptions: { noLib: true } });
  const source = parser.createSourceFile("/candidate.ts", `const candidate = (${text});`);
  const statements = source.getStatements();
  const statement = statements[0];
  if (statements.length !== 1 || !Node.isVariableStatement(statement) ||
      statement.getDeclarations().length !== 1 || parser.getProgram().getSyntacticDiagnostics(source).length) {
    throw new Error("LLM output must contain exactly one expression");
  }
  let expression = statement.getDeclarations()[0]?.getInitializer();
  while (Node.isParenthesizedExpression(expression)) expression = expression.getExpression();
  if (!Node.isCallExpression(expression) || expression.getExpression().getText() !== callee) {
    throw new Error("LLM output must preserve the original callee");
  }
  if (source.getDescendants().some((node) =>
    Node.isAsExpression(node) || Node.isTypeAssertion(node) || Node.isNonNullExpression(node) ||
    node.getKind() === ts.SyntaxKind.AnyKeyword || node.getKind() === ts.SyntaxKind.NeverKeyword)) {
    throw new Error("LLM output cannot suppress type checking with assertions");
  }
}
