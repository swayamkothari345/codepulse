/**
 * JSON Reporter
 *
 * Serializes the analysis result to JSON and either writes it to a file
 * or prints it to stdout.
 *
 * The output is the full result object — every field is included so the
 * consumer can derive any downstream metric without re-running the analysis.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {object} result  — full analyzer result
 * @param {object} options — CLI options: { output }
 */
export async function renderJson(result, options = {}) {
  // Build a serializable copy (strip any residual AST nodes just in case)
  const payload = _sanitize(result);
  const json = JSON.stringify(payload, null, 2);

  if (options.output) {
    const dest = path.resolve(options.output);
    writeFileSync(dest, json, 'utf8');

    const { default: chalk } = await import('chalk');
    console.log(chalk.green(`✔ JSON report written to ${dest}`));
  } else {
    console.log(json);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Remove non-serializable / excessively large fields from file entries.
 * AST and raw source code are stripped; everything else is kept.
 */
function _sanitize(result) {
  return {
    ...result,
    files: (result.files ?? []).map(({ ast: _ast, code: _code, ...rest }) => rest),
  };
}
