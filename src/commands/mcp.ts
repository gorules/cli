import { defineCommand } from 'citty';
import { startBridge } from '../mcp/bridge';

const start = defineCommand({
  meta: {
    name: 'start',
    description: 'Start the MCP bridge (WebSocket + stdio)',
  },
  args: {
    port: {
      type: 'string',
      description: 'Server port',
      alias: 'p',
      default: '41919',
    },
    host: {
      type: 'string',
      description: 'Server host',
      alias: 'h',
      default: 'localhost',
    },
    url: {
      type: 'string',
      description: 'GoRules server URL',
      alias: 'u',
    },
    open: {
      type: 'boolean',
      description: 'Open browser on start',
      default: false,
    },
  },
  async run({ args }) {
    await startBridge({
      port: parseInt(args.port, 10),
      host: args.host,
      serverUrl: args.url,
      openBrowser: args.open,
    });
  },
});

export const mcp = defineCommand({
  meta: {
    name: 'mcp',
    description: 'MCP bridge for connecting AI tools to GoRules',
  },
  subCommands: {
    start,
  },
});
