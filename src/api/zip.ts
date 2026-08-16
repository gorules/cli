import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;

export interface ZipEntry {
  path: string;
  content: Buffer;
}

/**
 * Minimal zip reader over node's zlib. Artifacts are small, flat, deflate-only
 * archives, so pulling in a zip dependency would be more surface than the
 * format needs. Sizes always come from the central directory: streamed
 * archives write zeroes in the local header and defer to a data descriptor.
 */
export const readZip = (buffer: Buffer): ZipEntry[] => {
  const eocdOffset = findEocd(buffer);
  if (eocdOffset === -1) {
    throw new Error('Not a zip archive: end of central directory not found');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('Corrupt zip archive: bad central directory entry');
    }

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const path = buffer.toString('utf-8', cursor + 46, cursor + 46 + nameLength);

    cursor += 46 + nameLength + extraLength + commentLength;

    // Directory entries carry no data
    if (path.endsWith('/')) {
      continue;
    }

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`Corrupt zip archive: bad local header for ${path}`);
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.push({ path, content: Buffer.from(data) });
    } else if (method === 8) {
      entries.push({ path, content: inflateRawSync(data) });
    } else {
      throw new Error(`Unsupported compression method ${method} for ${path}`);
    }
  }

  return entries;
};

/** The comment field is variable length, so the record is found by scanning back. */
const findEocd = (buffer: Buffer): number => {
  const start = Math.max(0, buffer.length - EOCD_MIN_SIZE - 0xffff);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
};
