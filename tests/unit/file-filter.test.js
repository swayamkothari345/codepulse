import { describe, it, expect } from 'vitest';
import { FileFilter } from '../../src/core/file-filter.js';

const ROOT = '/project';

describe('FileFilter', () => {
  describe('extension filtering', () => {
    it('accepts .js files', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/src/app.js', ROOT)).toBe(true);
    });

    it('accepts .jsx files', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/src/App.jsx', ROOT)).toBe(true);
    });

    it('accepts .mjs files', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/src/utils.mjs', ROOT)).toBe(true);
    });

    it('accepts .cjs files', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/src/config.cjs', ROOT)).toBe(true);
    });

    it('rejects .ts files', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/src/app.ts', ROOT)).toBe(false);
    });

    it('rejects .md files', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/README.md', ROOT)).toBe(false);
    });

    it('rejects .json files', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/package.json', ROOT)).toBe(false);
    });

    it('rejects files with no extension', () => {
      const f = new FileFilter();
      expect(f.shouldInclude('/project/Makefile', ROOT)).toBe(false);
    });

    it('accepts custom extension list', () => {
      const f = new FileFilter({ extensions: ['.ts'] });
      expect(f.shouldInclude('/project/src/app.ts', ROOT)).toBe(true);
      expect(f.shouldInclude('/project/src/app.js', ROOT)).toBe(false);
    });
  });

  describe('default ignore patterns', () => {
    it('rejects files in node_modules', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.shouldInclude('/project/node_modules/lodash/index.js', ROOT)).toBe(false);
    });

    it('rejects deeply nested node_modules', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.shouldInclude('/project/node_modules/@scope/pkg/src/index.js', ROOT)).toBe(false);
    });

    it('rejects .min.js files', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.shouldInclude('/project/public/app.min.js', ROOT)).toBe(false);
    });

    it('rejects .bundle.js files', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.shouldInclude('/project/public/app.bundle.js', ROOT)).toBe(false);
    });

    it('rejects files in dist/', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.shouldInclude('/project/dist/index.js', ROOT)).toBe(false);
    });

    it('rejects files in build/', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.shouldInclude('/project/build/main.js', ROOT)).toBe(false);
    });

    it('rejects files in coverage/', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.shouldInclude('/project/coverage/lcov.js', ROOT)).toBe(false);
    });
  });

  describe('custom ignore patterns', () => {
    it('rejects files matching custom pattern', () => {
      const f = new FileFilter({ ignore: ['vendor/**'] });
      expect(f.shouldInclude('/project/vendor/lib.js', ROOT)).toBe(false);
    });

    it('does not reject files outside the custom pattern', () => {
      const f = new FileFilter({ ignore: ['vendor/**'] });
      expect(f.shouldInclude('/project/src/lib.js', ROOT)).toBe(true);
    });

    it('rejects multiple custom patterns', () => {
      const f = new FileFilter({ ignore: ['generated/**', 'mocks/**'] });
      expect(f.shouldInclude('/project/generated/api.js', ROOT)).toBe(false);
      expect(f.shouldInclude('/project/mocks/user.js', ROOT)).toBe(false);
    });
  });

  describe('exclusionReason', () => {
    it('returns reason for unsupported extension', () => {
      const f = new FileFilter();
      expect(f.exclusionReason('/project/app.ts', ROOT)).toMatch(/unsupported extension/);
    });

    it('includes the actual extension in reason', () => {
      const f = new FileFilter();
      expect(f.exclusionReason('/project/app.ts', ROOT)).toContain('.ts');
    });

    it('returns reason for ignored path', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.exclusionReason('/project/node_modules/x/index.js', ROOT)).toMatch(/ignore/);
    });

    it('returns null for accepted files', () => {
      const f = new FileFilter({ rootDir: ROOT });
      expect(f.exclusionReason('/project/src/app.js', ROOT)).toBeNull();
    });
  });
});
