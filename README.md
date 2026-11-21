# CodePulse

A static analysis tool for JavaScript codebases. It measures complexity, finds duplicate code, detects circular dependencies, and surfaces hygiene issues — then rolls everything into a single health score so you can track how a project changes over time.

It works on plain JavaScript: `.js`, `.mjs`, `.cjs`, and `.jsx`. No TypeScript, no build step required.

---

## Installation

This package is published to GitHub Packages. To install it, tell npm where to find the `@swayamkothari345` scope — either by adding a line to your project's `.npmrc`:

```
@swayamkothari345:registry=https://npm.pkg.github.com
```

Then install globally:

```bash
npm install -g @swayamkothari345/codepulse
```

Once installed, the `codepulse` command is available everywhere.

Requires Node 18 or later.

---

## Usage

### Analyze a project

```bash
codepulse analyze .
codepulse analyze ./src
codepulse analyze . --severity high       # only show high and critical issues
codepulse analyze . --format json         # machine-readable output
codepulse analyze . --format html -o report.html   # self-contained HTML report
```

The terminal report shows an overall health score (0–100), a breakdown across five dimensions, and a prioritised list of findings.

### Save a snapshot for tracking

```bash
codepulse analyze . --save
codepulse analyze . --save --label "before refactor"
```

Snapshots are stored in `.codepulse/snapshots/` inside your project. They are lightweight — only the scores, metrics, and issue counts are persisted, not the full AST.

### Compare two snapshots

```bash
codepulse compare .                        # latest vs previous
codepulse compare . <idA> <idB>            # specific snapshots
codepulse compare . --json                 # diff as JSON
```

### View history

```bash
codepulse history .
codepulse history . --limit 20
codepulse history . --json
codepulse history . --delete <snapshot-id>
```

### List rules

```bash
codepulse rules
codepulse rules --category complexity
codepulse rules --detail complexity/cyclomatic
```

### Generate a config file

```bash
codepulse init
```

---

## Health score

Each analysis produces one overall score (0–100) and five sub-scores:

| Dimension       | What it measures                                          | Default weight |
|-----------------|-----------------------------------------------------------|---------------|
| Complexity      | Cyclomatic and cognitive complexity, nesting depth        | 30%           |
| Duplication     | Percentage of lines appearing in duplicate blocks         | 20%           |
| Maintainability | File size, function length, parameter count               | 25%           |
| Dependencies    | Circular imports, files with excessive coupling           | 15%           |
| Hygiene         | Unused variables, empty catch blocks, magic numbers, console.log | 10%  |

Scores follow the same scale as letter grades:

| Score   | Label           |
|---------|-----------------|
| 90–100  | Excellent        |
| 80–89   | Good             |
| 70–79   | Fair             |
| 60–69   | Needs Attention  |
| 50–59   | Poor             |
| 0–49    | Critical         |

---

## Rules

Thirteen rules are enabled by default:

**Complexity**
- `complexity/cyclomatic` — functions with cyclomatic complexity above threshold (default: 10)
- `complexity/cognitive` — functions hard to read due to nesting (default: 15)
- `complexity/nesting-depth` — deeply nested control structures (default: 4)
- `complexity/parameters` — functions with too many parameters (default: 5)
- `complexity/function-length` — functions exceeding a line limit (default: 50)

**Code smells**
- `smell/large-file` — files exceeding a line limit (default: 500)
- `smell/magic-numbers` — numeric literals embedded in logic
- `smell/empty-catch` — catch blocks that swallow errors silently
- `smell/unused-vars` — declared variables that are never read

**Dependencies**
- `dependency/circular` — circular import chains
- `dependency/too-many-imports` — files importing an excessive number of local modules

**Duplication**
- `duplication/block` — identical or structurally similar code blocks

**Hygiene**
- `hygiene/console-log` — console.log statements left in production code

---

## Configuration

Create a `codepulse.config.js` in your project root (or run `codepulse init`):

```js
export default {
  // Extra paths to ignore (supports gitignore-style globs)
  ignore: ['vendor', 'generated/**'],

  // Extensions to analyze
  extensions: ['.js', '.mjs', '.cjs', '.jsx'],

  // Turn rules off or change their severity / options
  rules: {
    'smell/magic-numbers': 'off',
    'complexity/cyclomatic': { severity: 'critical', options: { threshold: 15 } },
    'smell/unused-vars': { options: { ignorePattern: '^_' } },
  },

  // Scoring weights — will be normalised to sum to 1.0
  scoring: {
    weights: {
      complexity:      0.35,
      duplication:     0.20,
      maintainability: 0.20,
      dependencies:    0.15,
      hygiene:         0.10,
    },
  },
};
```

You can also use a plain JSON file named `.codepulserc.json` if you prefer not to use ES modules.

### Environment variable overrides

Useful for CI pipelines where you want to control behaviour without touching the config file:

| Variable                   | Effect                                      |
|----------------------------|---------------------------------------------|
| `CODEPULSE_FAIL_ON`        | Exit 1 if any issue at this severity or above exists |
| `CODEPULSE_MAX_WARNINGS`   | Exit 1 if total issue count exceeds this number |
| `CODEPULSE_SEVERITY`       | Minimum severity shown in terminal output   |
| `CODEPULSE_FORMAT`         | Output format: `terminal`, `json`, or `html` |

---

## CI/CD integration

```bash
# Fail the build on any critical or high severity issue
codepulse analyze . --fail-on high --quiet

# Fail if there are more than 50 total issues
codepulse analyze . --max-warnings 50 --quiet

# Save a snapshot on every CI run to track trends
codepulse analyze . --save --label "$GIT_COMMIT_SHA" --quiet
```

`--quiet` suppresses all output except error messages, which keeps CI logs clean.

**Exit codes:**
- `0` — analysis completed, no failures triggered
- `1` — `--fail-on` or `--max-warnings` threshold breached
- `2` — config validation error

---

## Programmatic API

```js
import { Analyzer, ProjectScanner, loadConfig } from 'codepulse';
import { complexityAnalyzer, smellsAnalyzer } from 'codepulse/analyzers';

const config = await loadConfig();
const scanner = new ProjectScanner({ rootDir: './src' });
const { files } = await scanner.scan();

const analyzer = new Analyzer({ config, files, rootDir: './src' });
analyzer.registerAnalyzer(complexityAnalyzer);
analyzer.registerAnalyzer(smellsAnalyzer);

const result = await analyzer.analyze();
console.log(result.scores.overall);  // 0–100
console.log(result.issues);          // array of findings
```

---

## Development

```bash
git clone https://github.com/swayamkothari345/codepulse.git
cd codepulse
npm install

npm test               # run all 325 tests
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
npm run lint

# Analyze the project itself
npm run analyze:self
```

---

## License

MIT
