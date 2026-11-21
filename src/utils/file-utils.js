import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolve a path safely, preventing traversal outside of a known base.
 * Throws if the resolved path escapes the base directory.
 */
export function safePath(base, relative) {
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Path traversal detected: "${relative}" escapes base "${base}"`);
  }
  return resolved;
}

/**
 * Returns true if the given path is a symbolic link.
 */
export function isSymlink(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Read a file as UTF-8, returning null on any error rather than throwing.
 */
export function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Return the size of a file in bytes, or 0 if it cannot be stat'd.
 */
export function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Write JSON to a file atomically (write to .tmp then rename).
 */
export function writeJsonSafe(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}
