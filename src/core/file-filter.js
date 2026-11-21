import path from 'node:path';
import fs from 'node:fs';
import ignore from 'ignore';

/**
 * Patterns excluded by default regardless of user config.
 * These follow gitignore glob syntax as implemented by the `ignore` package.
 */
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  'node_modules/**',
  '.git',
  '.git/**',
  'dist',
  'dist/**',
  'build',
  'build/**',
  'coverage',
  'coverage/**',
  '.nyc_output',
  '.nyc_output/**',
  '.codepulse',
  '.codepulse/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/*.min.mjs',
  '**/*.map',
  '**/vendor/**',
  '**/generated/**',
];

const DEFAULT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);

export class FileFilter {
  /**
   * @param {object} options
   * @param {string}   [options.rootDir]   - Project root (used to load .gitignore).
   * @param {string[]} [options.ignore]    - Additional ignore patterns.
   * @param {string[]} [options.extensions]- Supported file extensions.
   */
  constructor(options = {}) {
    this._ig = ignore();
    this._ig.add(DEFAULT_IGNORE_PATTERNS);

    if (Array.isArray(options.ignore) && options.ignore.length > 0) {
      this._ig.add(options.ignore);
    }

    if (options.rootDir) {
      this._loadGitignore(options.rootDir);
    }

    this.extensions = options.extensions
      ? new Set(options.extensions)
      : DEFAULT_EXTENSIONS;
  }

  _loadGitignore(rootDir) {
    const gitignorePath = path.join(rootDir, '.gitignore');
    try {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      this._ig.add(content);
    } catch {
      // No .gitignore present — perfectly fine.
    }
  }

  /**
   * Returns true if the file at absolutePath should be analyzed.
   */
  shouldInclude(absolutePath, rootDir) {
    return this.exclusionReason(absolutePath, rootDir) === null;
  }

  /**
   * Returns a human-readable string explaining why the file is excluded,
   * or null if the file should be included.
   */
  exclusionReason(absolutePath, rootDir) {
    const ext = path.extname(absolutePath);
    if (!this.extensions.has(ext)) {
      return `unsupported extension: ${ext || '(none)'}`;
    }

    const relative = path.relative(rootDir, absolutePath);
    // Normalise to forward-slash for the `ignore` library on Windows/macOS.
    const normalized = relative.split(path.sep).join('/');

    if (this._ig.ignores(normalized)) {
      return 'matched ignore pattern';
    }

    return null;
  }
}
