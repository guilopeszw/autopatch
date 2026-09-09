import { runPublishCli } from "../src/automation/publish.js";

process.exitCode = await runPublishCli(process.argv.slice(2));
