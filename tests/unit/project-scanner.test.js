import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ProjectScanner } from '../../src/core/project-scanner.js';

let tmpDir;

function write(relPath, content) {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepulse-scanner-'));

  write('src/index.js',           'export const x = 1;');
  write('src/utils.js',           'export const y = 2;');
  write('src/component.jsx',      'export default () => null;');
  write('src/server.mjs',         'export const port = 3000;');
  write('src/config.cjs',         'module.exports = {};');

  write('node_modules/pkg/index.js', 'module.exports = {};');
  write('dist/bundle.js',            'var x=1;');
  write('build/output.js',           'var y=2;');
  write('coverage/report.js',        'var z=3;');

  write('src/app.min.js',         'var a=1;');
  write('src/app.bundle.js',      'var b=2;');

  write('README.md',              '# Test');
  write('package.json',           '{}');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ProjectScanner', () => {
  describe('file discovery', () => {
    it('finds .js files in src/', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      const names = files.map(f => path.basename(f));
      expect(names).toContain('index.js');
      expect(names).toContain('utils.js');
    });

    it('finds .jsx files', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.map(f => path.basename(f))).toContain('component.jsx');
    });

    it('finds .mjs files', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.map(f => path.basename(f))).toContain('server.mjs');
    });

    it('finds .cjs files', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.map(f => path.basename(f))).toContain('config.cjs');
    });
  });

  describe('default exclusions', () => {
    it('excludes node_modules', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.some(f => f.includes('node_modules'))).toBe(false);
    });

    it('excludes dist/', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.some(f => f.includes(`${path.sep}dist${path.sep}`))).toBe(false);
    });

    it('excludes build/', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.some(f => f.includes(`${path.sep}build${path.sep}`))).toBe(false);
    });

    it('excludes coverage/', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.some(f => f.includes(`${path.sep}coverage${path.sep}`))).toBe(false);
    });

    it('excludes .min.js files', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.some(f => f.endsWith('.min.js'))).toBe(false);
    });

    it('excludes .bundle.js files', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.some(f => f.endsWith('.bundle.js'))).toBe(false);
    });

    it('does not include non-JS files', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { files } = await scanner.scan();
      expect(files.every(f => /\.(js|mjs|cjs|jsx)$/.test(f))).toBe(true);
    });
  });

  describe('custom options', () => {
    it('respects custom ignore patterns', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir, ignore: ['src/**'] });
      const { files } = await scanner.scan();
      expect(files.every(f => !f.includes(`${path.sep}src${path.sep}`))).toBe(true);
    });

    it('respects maxFileSize option', async () => {
      // Write a large-ish file
      const bigPath = path.join(tmpDir, 'src/big.js');
      fs.writeFileSync(bigPath, 'x'.repeat(200), 'utf8');

      const scanner = new ProjectScanner({ rootDir: tmpDir, maxFileSize: 100 });
      const { files, skipped } = await scanner.scan();
      expect(files.some(f => f.endsWith('big.js'))).toBe(false);
      expect(skipped.some(s => s.path.endsWith('big.js'))).toBe(true);

      fs.unlinkSync(bigPath);
    });
  });

  describe('skipped file reporting', () => {
    it('reports skipped files with reasons', async () => {
      const scanner = new ProjectScanner({ rootDir: tmpDir });
      const { skipped } = await scanner.scan();
      expect(skipped.length).toBeGreaterThan(0);
      expect(skipped[0]).toHaveProperty('path');
      expect(skipped[0]).toHaveProperty('reason');
    });
  });

  describe('error cases', () => {
    it('throws for non-existent directory', async () => {
      const scanner = new ProjectScanner({ rootDir: '/nonexistent/path/xyz123' });
      await expect(scanner.scan()).rejects.toThrow('does not exist');
    });

    it('handles empty directory gracefully', async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepulse-empty-'));
      try {
        const scanner = new ProjectScanner({ rootDir: emptyDir });
        const { files } = await scanner.scan();
        expect(files).toHaveLength(0);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });
});
