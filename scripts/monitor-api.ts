import { runMonitorCli } from "../src/automation/monitor.js";

process.exitCode = await runMonitorCli(process.argv.slice(2));
