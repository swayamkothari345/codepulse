/**
 * Levelled logger. All output goes through here so callers never
 * import chalk directly and so-color / NO_COLOR is honoured everywhere.
 */

import chalk from 'chalk';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, verbose: 4 };

let currentLevel = LEVELS.info;

export function setLevel(level) {
  currentLevel = LEVELS[level] ?? LEVELS.info;
}

export function getLevel() {
  return Object.keys(LEVELS).find(k => LEVELS[k] === currentLevel) ?? 'info';
}

export function error(...args) {
  if (currentLevel >= LEVELS.error) {
    console.error(chalk.red('✖'), ...args);
  }
}

export function warn(...args) {
  if (currentLevel >= LEVELS.warn) {
    console.warn(chalk.yellow('⚠'), ...args);
  }
}

export function info(...args) {
  if (currentLevel >= LEVELS.info) {
    console.log(chalk.blue('ℹ'), ...args);
  }
}

export function verbose(...args) {
  if (currentLevel >= LEVELS.verbose) {
    console.log(chalk.gray('·'), ...args);
  }
}

export function success(...args) {
  if (currentLevel >= LEVELS.info) {
    console.log(chalk.green('✔'), ...args);
  }
}

export function plain(...args) {
  if (currentLevel >= LEVELS.info) {
    console.log(...args);
  }
}
