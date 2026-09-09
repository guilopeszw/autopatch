import { ts, type Project } from "ts-morph";

/** Serializable compiler error. Offsets address the current, unsaved source text. */
export interface CompilerError {
  code: number;
  message: string;
  file?: string;
  line?: number;
  start?: number;
  length?: number;
}

export interface TypeCheckResult {
  success: boolean;
  errors: CompilerError[];
}

/**
 * Check the complete Project, including unsaved edits, without emitting files.
 * Syntactic, semantic, configuration and global errors all close the write gate.
 * Diagnostics come from the same native compiler instance that owns the AST.
 */
export function checkProject(project: Project): TypeCheckResult {
  const errors = project.getPreEmitDiagnostics()
    .filter((diagnostic) => diagnostic.getCategory() === ts.DiagnosticCategory.Error)
    .map((diagnostic): CompilerError => {
      const result: CompilerError = {
        code: diagnostic.getCode(),
        message: ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, "\n"),
      };
      const file = diagnostic.getSourceFile();
      const line = diagnostic.getLineNumber();
      const start = diagnostic.getStart();
      const length = diagnostic.getLength();
      if (file) result.file = file.getFilePath();
      if (line !== undefined) result.line = line;
      if (start !== undefined) result.start = start;
      if (length !== undefined) result.length = length;
      return result;
    });
  return { success: errors.length === 0, errors };
}
