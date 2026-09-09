#!/usr/bin/env -S npx tsx
/** Process boundary only. The CLI module is embeddable and independently testable. */
import { runCli } from "../src/cli.js";

process.exitCode = await runCli(process.argv.slice(2));
