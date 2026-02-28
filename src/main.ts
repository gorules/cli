#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { mcp } from './commands/mcp';

const main = defineCommand({
  meta: {
    name: 'gorules',
    version: '1.0.0',
    description: 'GoRules CLI',
  },
  subCommands: {
    mcp,
  },
});

void runMain(main);
