#!/usr/bin/env node
import { defineCommand, runCommand, showUsage, type CommandDef } from 'citty';
import { mcp } from './commands/mcp';
import { pull } from './commands/pull';
import { CliError } from './api/client';
import { version as VERSION } from '../package.json';

const main = defineCommand({
  meta: {
    name: 'gorules',
    version: VERSION,
    description: 'GoRules CLI',
  },
  subCommands: {
    mcp,
    pull,
  },
});

/** Walks `<cmd> <sub> <sub>` so `--help` lands on the command actually named. */
const resolveCommand = (rawArgs: string[]): [CommandDef, CommandDef | undefined] => {
  let command: CommandDef = main;
  let parent: CommandDef | undefined;

  for (const arg of rawArgs) {
    if (arg.startsWith('-')) {
      break;
    }
    const subCommands = command.subCommands as Record<string, CommandDef> | undefined;
    const next = subCommands?.[arg];
    if (!next) {
      break;
    }
    parent = command;
    command = next;
  }

  return [command, parent];
};

const run = async (): Promise<void> => {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    await showUsage(...resolveCommand(rawArgs));
    return;
  }

  if (rawArgs.length === 1 && (rawArgs[0] === '--version' || rawArgs[0] === '-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  await runCommand(main, { rawArgs });
};

// Errors surface as one readable line plus a meaningful exit code, which is
// what a pipeline branches on; citty's own handler prints a stack and always
// exits 1.
void run().catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
