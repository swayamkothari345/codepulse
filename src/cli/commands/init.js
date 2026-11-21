import path from 'node:path';
import fs from 'node:fs';

const CONFIG_TEMPLATE = `/** @type {import('codepulse').Config} */
export default {
  // Directories/glob patterns to ignore (extends built-in defaults)
  ignore: [],

  // File extensions to analyze
  extensions: ['.js', '.mjs', '.cjs', '.jsx'],

  // Rule configuration
  // Values: 'off' | { severity: 'critical'|'high'|'medium'|'low', options: {...} }
  rules: {
    // 'complexity/cyclomatic': { severity: 'high', options: { threshold: 10 } },
    // 'smell/empty-catch': 'off',
    // 'smell/magic-numbers': { severity: 'low', options: { ignore: [0, 1, -1] } },
  },

  // Scoring weights (should conceptually sum to 1.0)
  scoring: {
    weights: {
      complexity:      0.30,
      duplication:     0.20,
      maintainability: 0.25,
      dependencies:    0.15,
      hygiene:         0.10,
    },
  },
};
`;

export function registerInitCommand(program) {
  program
    .command('init')
    .description('Create a codepulse.config.js in the current directory')
    .option('--force', 'Overwrite existing config')
    .action(async (options) => {
      const { default: chalk } = await import('chalk');
      const dest = path.join(process.cwd(), 'codepulse.config.js');

      if (fs.existsSync(dest) && !options.force) {
        console.log(chalk.yellow(`codepulse.config.js already exists. Use --force to overwrite.`));
        return;
      }

      fs.writeFileSync(dest, CONFIG_TEMPLATE, 'utf8');
      console.log(chalk.green('✔') + ' Created ' + chalk.bold('codepulse.config.js'));
      console.log(chalk.dim('  Edit it to customise rules, thresholds, and ignored paths.'));
    });
}
