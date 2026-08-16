import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { CliError } from './client';
import { readZip } from './zip';

/** Zip paths are untrusted input; never let one escape the output directory. */
const safeJoin = (root: string, entryPath: string): string => {
  const target = resolve(root, entryPath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new CliError(`Refusing to write outside the output directory: ${entryPath}`);
  }
  return target;
};

/**
 * macOS and Windows filesystems are case-insensitive by default; comparing
 * paths case-sensitively there would delete a file the extract just wrote
 * under a different casing.
 */
const comparablePath = (path: string): string =>
  process.platform === 'darwin' || process.platform === 'win32' ? path.toLowerCase() : path;

/**
 * Symlinks are listed as files and never followed, so a link inside the
 * output directory can never cause reads or deletions outside of it.
 */
const walkFiles = async (dir: string): Promise<string[]> => {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkFiles(path)));
    } else {
      found.push(path);
    }
  }
  return found;
};

/**
 * Delete mode removes files, so it refuses a directory it cannot prove was written by
 * a previous pull: every artifact carries `.config/project.json`, so a
 * non-empty directory without one belongs to something else.
 */
const listOwnedFiles = async (root: string): Promise<string[]> => {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    // Missing directory: nothing to delete
    return [];
  }
  if (entries.length === 0) {
    return [];
  }

  const marker = join(root, '.config', 'project.json');
  const hasMarker = await stat(marker).then(
    () => true,
    () => false,
  );
  if (!hasMarker) {
    throw new CliError(
      `--delete refuses to touch "${root}": it contains files but no .config/project.json from a previous pull. Empty the directory yourself or drop --delete.`,
    );
  }

  return walkFiles(root);
};

/** Removes directories left empty by deletions; the root itself is kept. */
const pruneEmptyDirs = async (dir: string, isRoot: boolean): Promise<boolean> => {
  let empty = true;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const removed = await pruneEmptyDirs(join(dir, entry.name), false);
      if (!removed) {
        empty = false;
      }
    } else {
      empty = false;
    }
  }

  if (empty && !isRoot) {
    await rmdir(dir);
    return true;
  }
  return false;
};

export interface ExtractResult {
  /** Every artifact file now present on disk. */
  written: string[];
  /** The subset actually created or rewritten; byte-identical files are skipped. */
  updated: string[];
  deleted: string[];
}

/**
 * Write-to-temp then rename, so a concurrent reader (the agent's filesystem
 * provider, a running engine) sees either the old file or the new one, never a
 * truncated write. Rename also replaces a symlink entry rather than writing
 * through it.
 */
export const atomicWriteFile = async (file: string, content: Buffer): Promise<void> => {
  const tmp = join(dirname(file), `.${randomBytes(6).toString('hex')}.gorules-tmp`);
  try {
    await writeFile(tmp, content);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
};

/**
 * Writes the archive 1:1 under `root`, preserving paths including `.config/`.
 * `aws s3 sync` semantics: byte-identical files are left untouched (no mtime
 * churn, no watcher wake-ups) and only changed content is written, atomically.
 *
 * Default mode leaves every file the archive does not carry alone. Delete mode
 * (`s3 sync --delete`) makes the directory mirror the archive exactly: files
 * not in the archive are deleted, but only after every write has succeeded, so
 * a failure mid-extract leaves old and new side by side, never a hole.
 */
export const extractZipTo = async (
  buffer: Buffer,
  root: string,
  options: { delete?: boolean } = {},
): Promise<ExtractResult> => {
  // Fully parsed and decompressed before the first disk change: a corrupt
  // archive fails here, not halfway through an extraction.
  const entries = readZip(buffer);

  const existing = options.delete ? await listOwnedFiles(root) : [];

  const written: string[] = [];
  const updated: string[] = [];
  for (const entry of entries) {
    const file = safeJoin(root, entry.path);

    const current = await lstat(file).catch(() => null);
    if (current?.isDirectory()) {
      if (!options.delete) {
        throw new CliError(`Cannot write "${entry.path}": a directory is in the way. Remove it or use --delete.`);
      }
      await rm(file, { recursive: true, force: true });
    } else if (current?.isFile()) {
      // Only a regular file is compared: a symlink's content lives elsewhere,
      // so it must be replaced, not matched.
      const onDisk = await readFile(file);
      if (onDisk.equals(entry.content)) {
        written.push(file);
        continue;
      }
    }

    await mkdir(dirname(file), { recursive: true });
    await atomicWriteFile(file, entry.content);
    written.push(file);
    updated.push(file);
  }

  const deleted: string[] = [];
  if (options.delete) {
    const keep = new Set(written.map(comparablePath));
    for (const file of existing) {
      if (keep.has(comparablePath(file))) {
        continue;
      }
      try {
        await rm(file, { force: true });
        deleted.push(file);
      } catch (error) {
        // ENOTDIR: a directory on this path was replaced by a file during the
        // write phase, so the snapshot entry is already gone.
        if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') {
          throw error;
        }
      }
    }
    await pruneEmptyDirs(root, true);
  }

  return { written, updated, deleted };
};

export interface ArtifactManifest {
  project?: { key?: string | null; name?: string | null };
  release?: { version?: string | null } | null;
  commit?: { id?: string | null } | null;
}

/** The manifest the artifact carries at `.config/project.json`, when present. */
export const readManifest = (buffer: Buffer): ArtifactManifest | null => {
  const entry = readZip(buffer).find((item) => item.path === '.config/project.json');
  if (!entry) {
    return null;
  }

  try {
    return JSON.parse(entry.content.toString('utf-8')) as ArtifactManifest;
  } catch {
    return null;
  }
};
