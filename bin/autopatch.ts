#!/usr/bin/env -S npx tsx
/** CLI scaffold. Migration commands will be added with the patch pipeline. */
import { Command } from "commander";

const program = new Command()
  .name("autopatch")
  .description("AST-driven API migrations with in-memory TypeScript validation.")
  .version("0.1.0");

program.action(() => program.help());
program.parse();
