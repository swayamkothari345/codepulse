import path from 'node:path';
import fs from 'node:fs';
import fg from 'fast-glob';
import { FileFilter } from './file-filter.js';
import { isSymlink } from '../utils/file-utils.js';
import * as logger from '../utils/logger.js';

// fast-glob hard-ignores; these supplement the FileFilter exclusions at the
// glob level for speed — no point even stat-ing these entries.
const FG_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.nyc_output/**',
];

const DEFAULT_MAX_FILE_SIZE = 1_000_000; // 1 MB

export class ProjectScanner {
  /**
   * @param {object} options
   * @param {string}   options.rootDir        - Directory to scan.
   * @param {string[]} [options.ignore]       - Extra ignore patterns.
   * @param {string[]} [options.extensions]   - File extensions to include.
   * @param {boolean}  [options.followSymlinks] - Follow symlinks (default false).
   * @param {number}   [options.maxFileSize]  - Max bytes per file (default 1 MB).
   */
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.followSymlinks = options.followSymlinks ?? false;
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

    this._filter = new FileFilter({
      rootDir: this.rootDir,
      ignore: options.ignore ?? [],
      extensions: options.extensions,
    });
  }

  /**
   * Scan the project directory and return categorised file lists.
   *
   * Returns:
   *   {
   *     files:   string[],                       — absolute paths to analyze
   *     skipped: { path: string, reason: string }[] — excluded files with reasons
   *   }
   */
  async scan() {
    if (!fs.existsSync(this.rootDir)) {
      throw new Error(`Directory does not exist: ${this.rootDir}`);
    }

    const stat = fs.statSync(this.rootDir);
    if (!stat.isDirectory()) {
      // Single-file mode: treat target as the only file to analyse
      const reason = this._filter.exclusionReason(this.rootDir, path.dirname(this.rootDir));
      if (reason) {
        logger.warn(`File excluded: ${reason}`);
        return { files: [], skipped: [{ path: this.rootDir, reason }] };
      }
      return { files: [this.rootDir], skipped: [] };
    }

    logger.verbose(`Scanning: ${this.rootDir}`);

    const entries = await fg('**/*', {
      cwd: this.rootDir,
      absolute: true,
      onlyFiles: true,
      followSymbolicLinks: this.followSymlinks,
      dot: true,
      ignore: FG_IGNORE,
    });

    const accepted = [];
    const skipped = [];

    for (const entry of entries) {
      // Symlink guard
      if (!this.followSymlinks && isSymlink(entry)) {
        logger.verbose(`Skipping symlink: ${path.relative(this.rootDir, entry)}`);
        skipped.push({ path: entry, reason: 'symlink' });
        continue;
      }

      // File size guard
      let size = 0;
      try {
        size = fs.statSync(entry).size;
      } catch {
        skipped.push({ path: entry, reason: 'stat failed' });
        continue;
      }

      if (size > this.maxFileSize) {
        const rel = path.relative(this.rootDir, entry);
        logger.verbose(`Skipping large file: ${rel} (${size} bytes)`);
        skipped.push({ path: entry, reason: `exceeds max file size (${size} bytes > ${this.maxFileSize})` });
        continue;
      }

      // Extension + ignore filter
      const reason = this._filter.exclusionReason(entry, this.rootDir);
      if (reason) {
        logger.verbose(`Skipping ${path.relative(this.rootDir, entry)}: ${reason}`);
        skipped.push({ path: entry, reason });
        continue;
      }

      accepted.push(entry);
    }

    logger.verbose(`Accepted ${accepted.length} files, skipped ${skipped.length}`);
    return { files: accepted, skipped };
  }
}
