import { getAllRules, getRule } from '../../rules/registry.js';
import { registerDefaultRules } from '../../rules/defaults.js';

export function registerRulesCommand(program) {
  program
    .command('rules')
    .description('List or inspect available analysis rules')
    .option('--category <cat>', 'Filter by category: complexity|smell|duplication|dependency|hygiene')
    .option('--detail <id>', 'Show full details for a specific rule ID')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      registerDefaultRules();
      const { default: chalk } = await import('chalk');

      // ── Detail mode ───────────────────────────────────────────────────────
      if (options.detail) {
        const rule = getRule(options.detail);
        if (!rule) {
          console.error(chalk.red(`Rule not found: "${options.detail}"`));
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(rule, null, 2));
          return;
        }
        _renderDetail(chalk, rule);
        return;
      }

      // ── List mode ─────────────────────────────────────────────────────────
      let rules = getAllRules();
      if (options.category) {
        rules = rules.filter(r => r.category === options.category);
      }

      if (options.json) {
        const output = rules.map(({ id, name, description, category, severity, enabled, defaultOptions }) => ({
          id, name, description, category, severity, enabled, defaultOptions,
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      const { default: Table } = await import('cli-table3');

      const SEVERITY_COLOR = {
        critical: chalk.red.bold,
        high:     chalk.yellow,
        medium:   chalk.cyan,
        low:      chalk.gray,
      };

      const table = new Table({
        head: ['ID', 'Name', 'Category', 'Severity', 'Status'].map(h => chalk.bold.white(h)),
        style: { head: [], border: ['dim'] },
        colWidths: [32, 28, 14, 10, 10],
        wordWrap: true,
      });

      for (const rule of rules) {
        const colorFn = SEVERITY_COLOR[rule.severity] ?? (x => x);
        table.push([
          chalk.dim(rule.id),
          rule.name,
          rule.category,
          colorFn(rule.severity),
          rule.enabled !== false ? chalk.green('enabled') : chalk.gray('disabled'),
        ]);
      }

      console.log('\n' + chalk.bold.cyan('CodePulse') + ' — Available Rules\n');
      console.log(table.toString());
      console.log(chalk.dim(`\n  ${rules.length} rule${rules.length !== 1 ? 's' : ''} listed.`));
      console.log(chalk.dim('  Use --detail <id> for full rule info, or `codepulse init` to customise.\n'));
    });
}

function _renderDetail(chalk, rule) {
  const W   = 70;
  const div = chalk.dim('─'.repeat(W));
  const SEV = {
    critical: chalk.red.bold, high: chalk.yellow,
    medium: chalk.cyan, low: chalk.gray,
  };
  const sevFn = SEV[rule.severity] ?? (x => x);

  console.log('\n' + div);
  console.log(`  ${chalk.bold.cyan(rule.id)}`);
  console.log(div);
  console.log(`  ${chalk.dim('Name:')}        ${chalk.white(rule.name)}`);
  console.log(`  ${chalk.dim('Category:')}    ${rule.category}`);
  console.log(`  ${chalk.dim('Severity:')}    ${sevFn(rule.severity)}`);
  console.log(`  ${chalk.dim('Status:')}      ${rule.enabled !== false ? chalk.green('enabled') : chalk.gray('disabled')}`);
  console.log('');
  console.log(`  ${chalk.bold('Description:')}`);
  console.log(`  ${chalk.white(rule.description)}`);

  if (rule.defaultOptions && Object.keys(rule.defaultOptions).length > 0) {
    console.log('');
    console.log(`  ${chalk.bold('Default options:')}`);
    for (const [k, v] of Object.entries(rule.defaultOptions)) {
      console.log(`    ${chalk.dim(k + ':')} ${JSON.stringify(v)}`);
    }
    console.log('');
    console.log(`  ${chalk.dim('Override in codepulse.config.js:')}`);
    console.log(chalk.dim(`    rules: { '${rule.id}': { severity: '${rule.severity}', options: ${JSON.stringify(rule.defaultOptions)} } }`));
  }

  console.log('\n' + div + '\n');
}
