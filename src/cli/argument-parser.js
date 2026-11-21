import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setLevel } from '../utils/logger.js';

import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerCompareCommand } from './commands/compare.js';
import { registerHistoryCommand } from './commands/history.js';
import { registerInitCommand } from './commands/init.js';
import { registerRulesCommand } from './commands/rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

export function createCLI() {
  const program = new Command();

  program
    .name('codepulse')
    .description('Intelligent JavaScript code health analyzer')
    .version(pkg.version, '-v, --version', 'Print version number')
    .option('--no-color', 'Disable colored output')
    .option('--verbose', 'Enable verbose logging')
    .hook('preAction', (thisCommand) => {
      if (thisCommand.opts().noColor) {
        process.env.NO_COLOR = '1';
        process.env.FORCE_COLOR = '0';
      }
      if (thisCommand.opts().verbose) {
        setLevel('verbose');
      }
    });

  registerAnalyzeCommand(program);
  registerCompareCommand(program);
  registerHistoryCommand(program);
  registerInitCommand(program);
  registerRulesCommand(program);

  // Show help by default if no command is given
  program.addHelpCommand('help [command]', 'Display help for a command');

  return program;
}
