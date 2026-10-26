# fakegreen (hand-written)

This is my hand-written take on [fakegreen](https://github.com/fitzyracing1/fakegreen). Same tool, same rules,
same flags and output. I went back through the code and rewrote it the way I'd write it myself: plainer names,
fewer doc-comment blocks that just repeat the code, and comments only where the *why* isn't obvious.

If you want the maintained, published version, use the original. This repo is for reading.

## What it does

I kept catching coding agents (Claude Code, Codex, Cursor, Gemini CLI, Aider) "fixing" a failing build by
cheating: `.skip` on the test, `toBe(42)` turned into `toBeDefined()`, a `@ts-ignore`, a sneaky
`NODE_ENV === 'test'` branch, or `|| true` on the CI step. Then: *"All tests pass ✅"*.

fakegreen reads the git diff and flags those moves before a fake green build gets merged. No LLM, no API key,
no runtime dependencies, and it usually finishes in well under 100 ms.

## Running it

You need Node 18+ and `git`.

```sh
git clone https://github.com/fitzyracing1/fakegreen-handwritten
cd fakegreen-handwritten
npm ci && npm run build
node dist/cli.js                     # uncommitted + staged changes vs HEAD (plus untracked files)
node dist/cli.js --base origin/main  # everything since you branched
node dist/cli.js --last-commit
node dist/cli.js --diff some.patch --json
```

`--help` lists everything. The short version:

- diff source: `--staged`, `--base <ref>`, `--last-commit`, `--commit <sha>`, `--diff <file|->`, `--no-untracked`
- output: `--format pretty|json|sarif|github` (or `--json` / `--sarif`), `--min-severity`, `--no-color`
- `--fail-on high|medium|low|none` decides when it exits 1 (default `high`)
- exit codes: 0 clean, 1 findings at or above `--fail-on`, 2 usage or git error

There's also `fakegreen hook --agent <name>` for end-of-turn hooks, and
`fakegreen install claude|codex|gemini|pre-commit|github-action|skill` to wire it up. The installer always shows
you the change first and asks before writing (`--dry-run` to just look, `--yes` to skip the question).

## The rules

| Rule | Default | What it catches |
|---|---|---|
| `test-file-deleted` | high | A test file was deleted (and not moved/renamed elsewhere in the diff). |
| `test-count-dropped` | high | The net number of test cases (test()/it()/def test_/func Test/#[test]/@Test) went down. |
| `test-skipped` | high | A skip was added: .skip, xit/xdescribe, @pytest.mark.skip/xfail, pytest.skip(), t.Skip(), #[ignore], @Disabled, @Ignore. |
| `test-focused` | high | .only / fit / fdescribe silently disables every other test in the file or run. |
| `test-conditional-skip` | low | A conditional skip (skipif, skipIf, importorskip, assumptions, `if testing.Short()`) was added. |
| `assertion-removed` | medium | Net assertion count in a test file dropped (expect/assert/t.Error/assert_eq!/assertEquals...). |
| `assertion-weakened` | high | A specific assertion (toBe/toEqual/assert x == y/assertEquals) was replaced by a vague one (toBeTruthy/toBeDefined/assert x/assertNotNull). |
| `assertion-trivial` | high | An assertion that can never fail was added (expect(true).toBe(true), assert True, assert!(true)). |
| `assertion-expected-changed` | low | Only the literal expected value of an assertion changed. Confirm the code was wrong, not the test. |
| `suppression-added` | medium | @ts-ignore, @ts-nocheck, @ts-expect-error, eslint-disable, # type: ignore, noqa, //nolint, #[allow(...)], @SuppressWarnings and friends. Blanket suppressions are medium, ones that name a specific rule are low, file/crate-wide ones are high. |
| `coverage-exclusion-added` | low | istanbul/c8/v8 ignore, pragma: no cover, LCOV_EXCL, #[coverage(off)]. |
| `ci-failure-ignored` | high | `\|\| true`, continue-on-error: true, allow_failure: true, --exit-zero, set +e on a test/lint/build command. |
| `ci-step-removed` | high | A command that ran tests, lint or type checks was removed from CI config, scripts or package.json. |
| `ci-step-disabled` | high | A CI job/step was disabled with `if: false` or `when: never`. |
| `test-script-neutered` | high | The package.json test script was replaced with echo/true/exit 0. |
| `test-exclusion-added` | medium | --passWithNoTests, -DskipTests, -x test, testPathIgnorePatterns, --ignore/--deselect, collect_ignore. |
| `coverage-threshold-lowered` | high | A coverage threshold (coverageThreshold, fail_under, --cov-fail-under, thresholds, jacoco minimum...) was lowered or removed. |
| `typecheck-weakened` | medium | tsconfig strict flags turned off, mypy ignore_errors / strict = false, pyright typeCheckingMode off. |
| `lint-rule-disabled` | low | A lint rule was switched to "off"/0 in an ESLint config. |
| `test-env-special-case` | high | Non-test source code branches on being under test (NODE_ENV === "test", JEST_WORKER_ID, "pytest" in sys.modules, testing.Testing(), cfg!(test)) or on CI. |
| `error-swallowed` | medium | New empty catch / except: pass / .catch(() => {}) / if err != nil {}. |
| `ignore-comment-added` | low | An inline fakegreen-ignore comment was added. Always reported so reviewers see what was waived. |

Run `fakegreen rules` for the same list in your terminal.

## Config

Put a `.fakegreenrc.json` in the repo root (or a `"fakegreen"` key in package.json):

```json
{
  "rules": { "lint-rule-disabled": "off", "assertion-removed": "high" },
  "ignore": ["generated/**"],
  "testPatterns": ["checks/**/*.ts"],
  "failOn": "medium"
}
```

When a change really is intentional, say so in a comment and it gets waived (and still shows up as
`ignore-comment-added`, so a reviewer sees it):

```ts
// fakegreen-ignore test-skipped -- upstream API is down, see #42
it.skip('talks to the upstream api', async () => { /* ... */ });
```

## How it's put together

`cli` → `git` (get the diff) → `diff` (parse it) → `lang` (a small per-language lexer, so a `.skip` inside a
string doesn't count) → `rules` → `analyze` (waivers, dedupe, sorting) → `report` (pretty, JSON, SARIF, GitHub
annotations). `npm test` builds everything and runs the whole suite with `node:test`.

## License

MIT. Copyright (c) 2026 Joshua Almeida. See [LICENSE](LICENSE).

## Plans

This project is free, and its license stays as is. Support it through [GitHub Sponsors](https://github.com/sponsors/fitzyracing1):

- **Free**: use the code, community support.
- **Pro ($49/month)**: priority issues and support.
- **Team ($199/month)**: priority support for your team plus early access.
