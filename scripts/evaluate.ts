import { Command } from "commander";
import { evaluateCase, type EvaluationResult } from "../src/evaluation/corpus.js";
import { corpus } from "../tests/fixtures/corpus/cases.js";

/** Offline acceptance report: safe rejections never inflate completed migrations. */
const program = new Command().name("evaluate")
  .description("Run the repository-owned migration corpus, compiler gates and runtime observations.")
  .option("--json", "emit machine-readable results")
  .parse();
const results: EvaluationResult[] = [];
// Sequential execution keeps native compiler memory bounded as the corpus grows.
for (const fixture of corpus) results.push(await evaluateCase(fixture));
const report = {
  total: results.length,
  passed: results.filter(result => result.passed).length,
  completedMigrations: results.filter(result => result.passed && result.status === "verified").length,
  expectedRejections: results.filter(result => result.passed && result.status === "blocked").length,
  failures: results.filter(result => !result.passed).length,
  llmRequests: results.reduce((sum, result) => sum + result.llmRequests, 0),
  results,
};
if (program.opts<{ json?: boolean }>().json) console.log(JSON.stringify(report, null, 2));
else {
  for (const result of results) console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}: ${result.status}${result.errors.length ? ` — ${result.errors.join("; ")}` : ""}`);
  console.log(`\n${report.passed}/${report.total} expectations passed; ${report.completedMigrations}/${report.total} migrations completed; ${report.expectedRejections} expected rejections; ${report.llmRequests} LLM requests.`);
  console.log("This curated corpus is not an estimate of production coverage.");
}
process.exitCode = report.failures ? 1 : 0;
