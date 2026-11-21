/**
 * Comparison Engine
 *
 * Computes a structured diff between two snapshots so the CLI can show
 * what improved, regressed, or stayed the same since the last run.
 *
 * Returned diff shape:
 * {
 *   snapshotA:   { id, timestamp, label, overall }
 *   snapshotB:   { id, timestamp, label, overall }
 *   overall:     ScoreDelta
 *   breakdown:   { complexity: ScoreDelta, duplication: ScoreDelta, … }
 *   metrics:     { totalLines: Delta, issueCount: Delta, filesAnalyzed: Delta }
 *   trend:       'improved' | 'regressed' | 'unchanged'
 * }
 *
 * ScoreDelta: { before, after, delta, direction: 'up'|'down'|'same' }
 * Delta:      { before, after, delta }
 */

const DIMENSIONS = ['complexity', 'duplication', 'maintainability', 'dependencies', 'hygiene'];

/**
 * Compare two snapshots.
 *
 * @param {object} snapA  — older snapshot (the baseline)
 * @param {object} snapB  — newer snapshot (the current)
 * @returns {object}      — diff object as described above
 */
export function compare(snapA, snapB) {
  const overall  = _scoreDelta(snapA.scores?.overall ?? null, snapB.scores?.overall ?? null);

  const breakdown = {};
  for (const dim of DIMENSIONS) {
    const a = snapA.scores?.breakdown?.[dim]?.score ?? null;
    const b = snapB.scores?.breakdown?.[dim]?.score ?? null;
    breakdown[dim] = _scoreDelta(a, b);
  }

  const metrics = {
    totalLines:    _delta(snapA.metrics?.totalLines    ?? 0, snapB.metrics?.totalLines    ?? 0),
    issueCount:    _delta(snapA.issueCount             ?? 0, snapB.issueCount             ?? 0),
    filesAnalyzed: _delta(snapA.filesAnalyzed          ?? 0, snapB.filesAnalyzed          ?? 0),
  };

  const trend = overall.delta > 0 ? 'improved'
              : overall.delta < 0 ? 'regressed'
              : 'unchanged';

  return {
    snapshotA: _ref(snapA),
    snapshotB: _ref(snapB),
    overall,
    breakdown,
    metrics,
    trend,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _scoreDelta(before, after) {
  if (before === null || after === null) {
    return { before, after, delta: null, direction: 'same' };
  }
  const delta = after - before;
  return {
    before,
    after,
    delta: +delta.toFixed(1),
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
  };
}

function _delta(before, after) {
  return { before, after, delta: after - before };
}

function _ref(snap) {
  return {
    id:        snap.id,
    timestamp: snap.timestamp,
    label:     snap.label ?? null,
    overall:   snap.scores?.overall ?? null,
  };
}
