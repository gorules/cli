import pc from 'picocolors';
import boxen from 'boxen';

function write(msg: string) {
  process.stderr.write(msg + '\n');
}

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return pc.dim(`${h}:${m}:${s}`);
}

export function printBanner(host: string, port: number, token: string) {
  const base = `${host}:${port}`;
  const mcpUrl = `http://${base}/mcp`;
  const evalUrl = `http://${base}/evaluate/{path}`;
  const fileUrl = `http://${base}/file/{path}`;
  const wsUrl = `ws://${base}`;

  const content = [
    pc.bold(pc.cyan('GoRules MCP Bridge')),
    '',
    `${pc.dim('MCP')}        ${pc.dim('→')}  ${pc.cyan(mcpUrl)}`,
    `${pc.dim('Evaluate')}   ${pc.dim('→')}  ${pc.cyan(evalUrl)}`,
    `${pc.dim('File')}       ${pc.dim('→')}  ${pc.cyan(fileUrl)}`,
    `${pc.dim('Browser')}    ${pc.dim('→')}  ${pc.cyan(wsUrl)}`,
    `${pc.dim('Token')}      ${pc.dim('→')}  ${pc.green(token)}`,
    `${pc.dim('Status')}     ${pc.dim('→')}  ${pc.yellow('Waiting for browser...')}`,
  ].join('\n');

  write('\n' + boxen(content, { padding: 1, borderStyle: 'round', dimBorder: true }) + '\n');
}

export function logEvent(message: string) {
  write(`  ${timestamp()}  ${message}`);
}

export function logToolCall(name: string, durationMs: number) {
  write(`  ${timestamp()}  ${pc.dim('←')} ${pc.white(name)} ${pc.dim(`(${durationMs}ms`)}${pc.dim(')')}`);
}

export function logConnect(projectName: string, toolCount: number) {
  write(`  ${timestamp()}  ${pc.green('Browser connected')}`);
  write(`  ${timestamp()}  ${pc.dim('Project:')} ${pc.white(projectName)} ${pc.dim(`(${toolCount} tools)`)}`);
}

export function logDisconnect(reason: string) {
  write(`  ${timestamp()}  ${pc.yellow('Browser disconnected')} ${pc.dim(`(${reason})`)}`);
}
