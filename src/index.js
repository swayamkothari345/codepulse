/**
 * CodePulse public API.
 * Import these when using CodePulse programmatically.
 */

export { Analyzer } from './core/analyzer.js';
export { ProjectScanner } from './core/project-scanner.js';
export { FileFilter } from './core/file-filter.js';

export { parseFile, walkAST, countLines, nodeLength, getFunctionName, isFunctionNode } from './utils/ast-utils.js';
export { readFileSafe, safePath, ensureDir, writeJsonSafe } from './utils/file-utils.js';

export { loadConfig, mergeConfig, DEFAULT_CONFIG } from './config/loader.js';

export { registerRule, getRule, getAllRules, getRulesByCategory, applyRulesConfig } from './rules/registry.js';
export { registerDefaultRules } from './rules/defaults.js';
