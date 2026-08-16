import { defineCommand } from 'citty';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import pc from 'picocolors';
import { CliError, downloadArtifact, resolveApiOptions, sync, type SyncDeploymentResult } from '../api/client';
import { atomicWriteFile, extractZipTo } from '../api/extract';

/**
 * Exit codes are part of the contract: pipelines branch on them.
 *   0 downloaded   3 nothing to do   4 no release   1 error   2 usage
 */
const EXIT_NO_CHANGE = 3;
const EXIT_NO_RELEASE = 4;

const describeFailure = (result: SyncDeploymentResult, project: string, target: string): CliError => {
  switch (result.action) {
    case 'no_access':
      return new CliError(
        `The access token cannot reach project "${project}". Check that the project exists and that the token's project scope includes it.`,
      );
    case 'no_release':
      return new CliError(
        `Nothing is deployed to "${target}" in project "${project}". Deploy a release to it first.`,
        EXIT_NO_RELEASE,
      );
    case 'error':
      return new CliError(`Could not resolve "${target}" in project "${project}": ${result.code ?? 'unknown error'}`);
    default:
      return new CliError(`Unexpected response for "${target}" in project "${project}": ${result.action}`);
  }
};

export const pull = defineCommand({
  meta: {
    name: 'pull',
    description: 'Download the rules artifact for a project target',
  },
  args: {
    project: {
      type: 'string',
      description: 'Project key or id (env: GORULES_PROJECT)',
      alias: 'p',
    },
    target: {
      type: 'string',
      description:
        "Target: 'main', 'branch:<id>', 'commit:<id>', 'release:<version>' or 'env:<key>' (env: GORULES_TARGET)",
      alias: 't',
    },
    out: {
      type: 'string',
      description: 'Output directory',
      alias: 'o',
      default: '.',
    },
    unpack: {
      type: 'boolean',
      description: 'Extract the archive into a directory instead of writing the zip',
      default: false,
    },
    delete: {
      type: 'boolean',
      description:
        'With --unpack: delete files in the destination that are not in the artifact, so the directory mirrors the target exactly. Without it, files the artifact does not carry are preserved',
      default: false,
    },
    name: {
      type: 'string',
      description:
        "Output file name, or sub-directory name with --unpack. Defaults to the project key with no extension, which is what the agent's object storage providers require. Pass '.' with --unpack to extract straight into --out",
    },
    current: {
      type: 'string',
      description: 'Release or commit id already held; exits 3 when unchanged',
    },
    url: { type: 'string', description: 'BRMS API URL (env: GORULES_URL)', alias: 'u' },
    token: { type: 'string', description: 'Access token (env: GORULES_TOKEN)' },
    json: { type: 'boolean', description: 'Print the result as JSON', default: false },
  },
  async run({ args }) {
    const options = resolveApiOptions(args);
    const project = args.project || process.env.GORULES_PROJECT;
    const target = args.target || process.env.GORULES_TARGET || 'main';

    if (!project) {
      throw new CliError('Missing project. Pass --project or set GORULES_PROJECT.', 2);
    }
    if (args.delete && !args.unpack) {
      throw new CliError('--delete only applies when extracting. Add --unpack.', 2);
    }

    // A `current` id is echoed back to the server, which answers no_change
    // rather than re-serving an artifact the caller already holds.
    const current = args.current ? { commitId: args.current, releaseId: args.current } : undefined;

    const response = await sync(options, [{ project, target, ...(current && { current }) }]);
    const result = response.deployments[0];

    if (!result) {
      throw new CliError('The server returned no result for this deployment.');
    }

    if (result.action === 'no_change') {
      if (args.json) {
        process.stdout.write(JSON.stringify({ action: 'no_change', project, target }) + '\n');
      } else {
        process.stderr.write(pc.dim(`Already up to date (${target}).\n`));
      }
      process.exitCode = EXIT_NO_CHANGE;
      return;
    }

    if (result.action !== 'load' || !result.artifact) {
      throw describeFailure(result, project, target);
    }

    const buffer = await downloadArtifact(options, result.artifact);
    const digest = createHash('sha256').update(buffer).digest('hex');

    // Verified only when the server supplied a digest: self-hosted installs
    // without CDN configuration serve the artifact directly and send none.
    if (result.artifact.sha256 && result.artifact.sha256.toLowerCase() !== digest) {
      throw new CliError('Artifact checksum mismatch: the download does not match what the server published.');
    }

    // Default to the project key with no extension: the agent's object
    // storage providers use the object name verbatim as the project key, so a
    // `.zip` suffix would surface a project literally called "pricing.zip".
    // The agent's local `zip` provider is the opposite and does strip it, so
    // that destination wants an explicit `--name <project>.zip`.
    const projectKey = result.project?.key ?? result.project?.id ?? project;
    const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : projectKey;
    const outDir = resolve(process.cwd(), args.out);
    const written: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];

    if (args.unpack) {
      const extracted = await extractZipTo(buffer, resolve(outDir, name), { delete: args.delete });
      written.push(...extracted.written);
      updated.push(...extracted.updated);
      deleted.push(...extracted.deleted);
    } else {
      if (name === '.' || name.endsWith('/')) {
        throw new CliError(`--name "${name}" is not a file name. Use --unpack to extract into a directory.`, 2);
      }
      const file = join(outDir, name);
      await mkdir(dirname(file), { recursive: true });
      await atomicWriteFile(file, buffer);
      written.push(file);
      updated.push(file);
    }

    const summary = {
      action: 'load' as const,
      project: result.project?.key ?? project,
      target,
      release: result.release?.id,
      version: result.release?.semanticVersion ?? result.release?.version ?? undefined,
      commit: result.commit?.id,
      environment: result.environment?.key ?? undefined,
      sha256: digest,
      verified: Boolean(result.artifact.sha256),
      files: written,
      ...(args.unpack && { updated }),
      ...(args.delete && { deleted }),
    };

    if (args.json) {
      process.stdout.write(JSON.stringify(summary) + '\n');
      return;
    }

    const label = summary.version ? `${summary.project}@${summary.version}` : `${summary.project} (${target})`;
    const counts = [
      `${written.length} file(s)`,
      ...(args.unpack ? [`${updated.length} updated`] : []),
      ...(deleted.length > 0 ? [`${deleted.length} removed`] : []),
    ].join(', ');
    process.stderr.write(`${pc.green('Pulled')} ${pc.bold(label)} ${pc.dim(`-> ${counts}`)}\n`);
    if (!summary.verified) {
      process.stderr.write(pc.dim('  server sent no checksum; download integrity not verified\n'));
    }
  },
});
