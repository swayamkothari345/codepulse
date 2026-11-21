/**
 * Re-exports all built-in analyzer modules so the CLI and
 * programmatic API have a single import point.
 */

export * as complexityAnalyzer from './complexity/index.js';
export * as smellsAnalyzer from './smells/index.js';
export * as duplicationAnalyzer from './duplication/index.js';
export * as dependencyAnalyzer from './dependencies/index.js';
