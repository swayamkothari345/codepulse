/**
 * Snapshot Manager
 *
 * Persists and retrieves analysis snapshots so users can track code health
 * over time and compare runs.
 *
 * Storage layout (relative to the analysed project root):
 *   <rootDir>/.codepulse/snapshots/
 *     index.json          — ordered list of snapshot metadata
 *     <id>.json           — full snapshot data
 *
 * Snapshot schema:
 *   {
 *     id:          string    — ISO timestamp slug, e.g. "2026-11-21T10-00-00"
 *     timestamp:   string    — ISO 8601 full timestamp
 *     rootDir:     string    — absolute path of the analysed project
 *     label:       string?   — optional human label (--label flag)
 *     scores:      object    — result.scores (overall + breakdown)
 *     metrics:     object    — result.metrics (totalLines, totalFiles, …)
 *     filesAnalyzed: number
 *     issueCount:  number
 *     issuesBySeverity: { critical, high, medium, low }
 *   }
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const SNAPSHOTS_DIR = '.codepulse/snapshots';
const INDEX_FILE    = 'index.json';

// ── Public API ────────────────────────────────────────────────────────────────

export class SnapshotManager {
  /**
   * @param {string} rootDir — the analysed project root (snapshots live here)
   */
  constructor(rootDir) {
    this.rootDir   = rootDir;
    this.storeDir  = path.join(rootDir, SNAPSHOTS_DIR);
    this.indexPath = path.join(this.storeDir, INDEX_FILE);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Save a snapshot derived from an analysis result.
   *
   * @param {object} result  — full analyzer result (with result.scores)
   * @param {object} options — { label?: string }
   * @returns {object}       — the saved snapshot record
   */
  save(result, options = {}) {
    this._ensureDir();

    const ts  = result.timestamp ?? new Date().toISOString();
    const id  = _makeId(ts);
    const snap = _distil(id, ts, result, options.label);

    writeFileSync(path.join(this.storeDir, `${id}.json`), JSON.stringify(snap, null, 2), 'utf8');
    this._appendIndex(snap);

    return snap;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Load a snapshot by ID.
   * @param {string} id
   * @returns {object|null}
   */
  load(id) {
    if (!_safeId(id)) return null;
    const p = path.join(this.storeDir, `${id}.json`);
    // Ensure resolved path stays inside storeDir (path traversal guard)
    if (!path.resolve(p).startsWith(path.resolve(this.storeDir) + path.sep)) return null;
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  }

  /**
   * List all stored snapshots, most recent first.
   * Returns lightweight metadata (not full snapshot data).
   * @returns {object[]}
   */
  list() {
    if (!existsSync(this.indexPath)) return [];
    return JSON.parse(readFileSync(this.indexPath, 'utf8')).reverse();
  }

  /**
   * Return the N most recent snapshots (full data).
   * @param {number} n
   * @returns {object[]}
   */
  recent(n = 10) {
    return this.list()
      .slice(0, n)
      .map(meta => this.load(meta.id))
      .filter(Boolean);
  }

  /**
   * Delete a snapshot by ID.
   * @param {string} id
   * @returns {boolean} true if deleted, false if not found
   */
  delete(id) {
    if (!_safeId(id)) return false;
    const p = path.join(this.storeDir, `${id}.json`);
    if (!path.resolve(p).startsWith(path.resolve(this.storeDir) + path.sep)) return false;
    if (!existsSync(p)) return false;
    unlinkSync(p);
    this._removeFromIndex(id);
    return true;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _ensureDir() {
    mkdirSync(this.storeDir, { recursive: true });
    if (!existsSync(this.indexPath)) {
      writeFileSync(this.indexPath, '[]', 'utf8');
    }
  }

  _appendIndex(snap) {
    const index = existsSync(this.indexPath)
      ? JSON.parse(readFileSync(this.indexPath, 'utf8'))
      : [];
    index.push(_metaOf(snap));
    writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  _removeFromIndex(id) {
    if (!existsSync(this.indexPath)) return;
    const index = JSON.parse(readFileSync(this.indexPath, 'utf8'));
    const filtered = index.filter(m => m.id !== id);
    writeFileSync(this.indexPath, JSON.stringify(filtered, null, 2), 'utf8');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert ISO timestamp to a filesystem-safe ID string. */
function _makeId(ts) {
  return ts.replace(/[:.]/g, '-').replace('T', 'T').slice(0, 23).replace(/\./g, '-');
}

/** Extract the fields we store in the snapshot file. */
function _distil(id, ts, result, label) {
  const bySev = (result.issues ?? []).reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] ?? 0) + 1;
    return acc;
  }, {});

  return {
    id,
    timestamp: ts,
    label:     label ?? null,
    rootDir:   result.rootDir,
    scores:    result.scores ?? null,
    metrics:   result.metrics ?? {},
    filesAnalyzed:    result.filesAnalyzed ?? 0,
    issueCount:       (result.issues ?? []).length,
    issuesBySeverity: bySev,
  };
}

/** Lightweight metadata kept in the index (no full scores breakdown). */
function _metaOf(snap) {
  return {
    id:           snap.id,
    timestamp:    snap.timestamp,
    label:        snap.label,
    overall:      snap.scores?.overall ?? null,
    issueCount:   snap.issueCount,
    filesAnalyzed: snap.filesAnalyzed,
  };
}

/**
 * Validate a snapshot ID before using it in a file path.
 * Allows only the characters produced by _makeId(): alphanumerics, dashes, T.
 * Rejects any path traversal attempts (dots, slashes, etc.).
 */
function _safeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9T\-]+$/.test(id);
}
