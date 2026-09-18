'use strict';
/**
 * Minimal ZIP reader (no npm dependency).
 *
 * Supports the two compression methods every SCORM packaging tool uses:
 * 0 = stored (no compression) and 8 = deflate. Reads the central directory
 * from the end of the file (handles a trailing zip comment) rather than
 * trusting local file headers, which is the robust way to parse zips.
 */

const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEndOfCentralDirectory(buf) {
  // EOCD is at least 22 bytes, and can be followed by a comment of up to 65535 bytes.
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      return i;
    }
  }
  throw new Error('Not a valid zip file (end of central directory record not found)');
}

function decodeName(buf, isUtf8) {
  return buf.toString(isUtf8 ? 'utf8' : 'utf8'); // filenames in SCORM zips are effectively always utf8/ascii
}

/**
 * Parse a zip file buffer into a list of entries:
 * { name, isDirectory, getData(): Buffer }
 */
function readZipEntries(buf) {
  const eocdPos = findEndOfCentralDirectory(buf);
  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  let cdOffset = buf.readUInt32LE(eocdPos + 16);
  const cdSize = buf.readUInt32LE(eocdPos + 12);

  // Sanity check for the (rare) zip64 / prepended-data case: if the offset
  // looks wrong, recompute it from the EOCD position and recorded size.
  if (cdOffset + cdSize > eocdPos || cdOffset > buf.length) {
    const guess = eocdPos - cdSize;
    if (guess >= 0) cdOffset = guess;
  }

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== CEN_SIG) {
      throw new Error('Corrupt zip: central directory entry signature mismatch');
    }
    const generalFlag = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttrs = buf.readUInt32LE(pos + 38);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const nameStart = pos + 46;
    const name = decodeName(buf.slice(nameStart, nameStart + nameLen), (generalFlag & 0x800) !== 0);

    const isDirectory = name.endsWith('/') || (externalAttrs & 0x10) !== 0;

    entries.push({
      name,
      isDirectory,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      getData() {
        return extractEntryData(buf, this);
      }
    });

    pos = nameStart + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntryData(buf, entry) {
  const off = entry.localHeaderOffset;
  if (buf.readUInt32LE(off) !== LOC_SIG) {
    throw new Error(`Corrupt zip: local header signature mismatch for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const compressed = buf.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) {
    return compressed;
  } else if (entry.method === 8) {
    return zlib.inflateRawSync(compressed);
  } else {
    throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.name} (only stored/deflate are supported)`);
  }
}

const fs = require('fs');
const path = require('path');

/**
 * Extract every entry in a zip buffer to targetDir, guarding against
 * zip-slip (entries whose name tries to escape the target directory via
 * `../` or an absolute path).
 *
 * Returns the list of relative file paths (posix-style, forward slashes)
 * that were written.
 */
function extractZipToDir(buf, targetDir) {
  const entries = readZipEntries(buf);
  const written = [];
  const resolvedTarget = path.resolve(targetDir);

  for (const entry of entries) {
    const normalized = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) {
      // Skip suspicious entries rather than aborting the whole upload.
      continue;
    }
    const destPath = path.resolve(targetDir, normalized);
    if (!destPath.startsWith(resolvedTarget + path.sep) && destPath !== resolvedTarget) {
      continue; // zip-slip attempt
    }

    if (entry.isDirectory) {
      fs.mkdirSync(destPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, entry.getData());
    written.push(normalized);
  }

  return written;
}

module.exports = { readZipEntries, extractZipToDir };
