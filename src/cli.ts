#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { analyzeDiffs, meetsThreshold } from './analyze';
import { ConfigError, loadConfig } from './config';
import { parseDiff } from './diff';
import { DiffMode, getDiff, GitError, repoRoot } from './git';
import { runHook } from './hook';
import { applyPlan, confirm, INSTALL_TARGETS, InstallTarget, planInstall, renderPlan } from './install';
import { colors, shouldColor } from './report/color';
import { renderGithub, renderJson, renderSarif, VERSION } from './report/machine';
import { filterMin, renderPretty } from './report/pretty';
import { RULES } from './rules/registry';
import { Severity } from './types';

const HELP = `fakegreen ${VERSION}
One command scans your agent's diff and flags every way it faked a green build.

Usage
  fakegreen [options]                 scan uncommitted + staged changes vs HEAD (+ untracked files)
  fakegreen hook --agent <name>       end-of-turn hook mode (reads hook JSON on stdin)
  fakegreen install <target>          claude | codex | gemini | pre-commit | github-action | skill
  fakegreen rules                     list all rules

Diff source (pick one)
  --staged                 only staged changes
  --base <ref>             everything since the merge-base with <ref> (e.g. origin/main), incl. uncommitted
  --last-commit            the last commit (HEAD~1..HEAD)
  --commit <sha>           a specific commit
  --diff <file|->          read a unified diff from a file or stdin
  --no-untracked           ignore untracked files in working-tree scans

Output
  --json | --sarif         machine-readable output (same as --format json|sarif)
  --format <f>             pretty (default) | json | sarif | github
  --fail-on <sev>          exit 1 when a finding is >= high | medium | low | none (default: high)
  --min-severity <sev>     hide findings below this severity (default: low)
  --no-color / --color     force colors off/on (NO_COLOR and FORCE_COLOR are respected)
  -C, --cwd <dir>          run as if started in <dir>
  --config <file>          config file (default: .fakegreenrc.json, .fakegreenrc, package.json#fakegreen)

Install options
  --yes, -y                write without asking        --dry-run       only show the change
  --global                 user-level config (~/.claude, ~/.codex, ~/.gemini)
  --local                  Claude only: .claude/settings.local.json
  --command <cmd>          how hooks invoke fakegreen (default: "npx --yes fakegreen")
  --hook-args <args>       extra args for the hook command, e.g. "--base origin/main"

Exit codes: 0 clean, 1 findings at/above --fail-on, 2 usage or git error.
Docs: https://github.com/fitzyracing1/fakegreen`;

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

const VALUE_FLAGS = new Set(['base', 'commit', 'diff', 'format', 'fail-on', 'min-severity', 'cwd', 'config', 'agent', 'command', 'hook-args']);
const ALIASES: Record<string, string> = { C: 'cwd', y: 'yes', h: 'help', v: 'version' };

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      let name = a.replace(/^--?/, '');
      let value: string | boolean | undefined;
      const eq = name.indexOf('=');
      if (eq >= 0) { value = name.slice(eq + 1); name = name.slice(0, eq); }
      name = ALIASES[name] ?? name;
      if (name.startsWith('no-') && !VALUE_FLAGS.has(name)) { out.flags[name.slice(3)] = false; continue; }
      if (VALUE_FLAGS.has(name) && value === undefined) {
        value = argv[++i];
        if (value === undefined) throw new UsageError(`--${name} needs a value`);
      }
      out.flags[name] = value ?? true;
    } else out._.push(a);
  }
  return out;
}

class UsageError extends Error {}

const SEVERITIES = ['high', 'medium', 'low'];

function parseSeverity(v: unknown, name: string, allowNone = false): Severity | 'none' | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string' && (SEVERITIES.includes(v) || (allowNone && v === 'none'))) return v as Severity | 'none';
  throw new UsageError(`--${name} must be one of ${SEVERITIES.join('|')}${allowNone ? '|none' : ''}`);
}

function pickDiffMode(flags: Args['flags']): DiffMode {
  const chosen = ['staged', 'base', 'last-commit', 'commit'].filter((k) => flags[k] !== undefined && flags[k] !== false);
  if (chosen.length > 1) throw new UsageError(`Choose only one of --staged, --base, --last-commit, --commit`);
  if (flags.staged) return { kind: 'staged' };
  if (typeof flags.base === 'string') return { kind: 'base', ref: flags.base };
  if (flags['last-commit']) return { kind: 'last-commit' };
  if (typeof flags.commit === 'string') return { kind: 'commit', sha: flags.commit };
  return { kind: 'worktree' };
}

function readStdin(): string {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const flags = args.flags;
  if (flags.version) { process.stdout.write(VERSION + '\n'); return 0; }
  if (flags.help) { process.stdout.write(HELP + '\n'); return 0; }
  const cwd = path.resolve(typeof flags.cwd === 'string' ? flags.cwd : process.cwd());
  const cmd = args._[0] ?? 'scan';

  if (cmd === 'rules') {
    const c = colors(shouldColor(process.stdout, typeof flags.color === 'boolean' ? flags.color : undefined));
    for (const r of RULES) process.stdout.write(`${c.bold(r.id.padEnd(28))} ${r.severity.padEnd(7)} ${r.description}\n`);
    return 0;
  }

  if (cmd === 'hook') {
    const out = runHook(readStdin(), {
      agent: typeof flags.agent === 'string' ? flags.agent : undefined,
      failOn: parseSeverity(flags['fail-on'], 'fail-on') as Severity | undefined,
      mode: pickDiffMode(flags),
    });
    if (out.stdout) process.stdout.write(out.stdout + '\n');
    return out.exitCode;
  }

  if (cmd === 'install') {
    const target = args._[1] as InstallTarget;
    if (!INSTALL_TARGETS.includes(target)) throw new UsageError(`install target must be one of: ${INSTALL_TARGETS.join(', ')}`);
    const plan = planInstall(target, {
      cwd,
      global: !!flags.global,
      local: !!flags.local,
      command: typeof flags.command === 'string' ? flags.command : undefined,
      hookArgs: typeof flags['hook-args'] === 'string' ? flags['hook-args'] : undefined,
    });
    process.stdout.write(renderPlan(plan, cwd) + '\n');
    if (plan.alreadyInstalled) return 0;
    if (flags['dry-run']) { process.stdout.write('\n(dry run: nothing written)\n'); return 0; }
    let ok = !!flags.yes;
    if (!ok) {
      if (!process.stdin.isTTY) {
        process.stderr.write('\nNot a terminal; re-run with --yes to write this change.\n');
        return 2;
      }
      ok = await confirm(`\nWrite ${plan.file}? [y/N] `);
    }
    if (!ok) { process.stdout.write('Aborted; nothing written.\n'); return 1; }
    applyPlan(plan);
    process.stdout.write(`\n✔ Wrote ${plan.file}\n`);
    for (const n of plan.notes) process.stdout.write(`  • ${n}\n`);
    return 0;
  }

  if (cmd !== 'scan') throw new UsageError(`Unknown command "${cmd}". Run fakegreen --help.`);

  const started = Date.now();
  let root = cwd;
  let description: string;
  let diffs;
  const fromDiff = typeof flags.diff === 'string' ? flags.diff : undefined;
  if (!fromDiff) root = repoRoot(cwd);
  else { try { root = repoRoot(cwd); } catch { root = cwd; } }
  const config = loadConfig(root, typeof flags.config === 'string' ? flags.config : undefined);
  if (fromDiff) {
    const text = fromDiff === '-' ? readStdin() : fs.readFileSync(path.resolve(cwd, fromDiff), 'utf8');
    diffs = parseDiff(text);
    description = fromDiff === '-' ? 'diff from stdin' : `diff file ${fromDiff}`;
  } else {
    const src = getDiff(pickDiffMode(flags), root, { untracked: flags.untracked === false ? false : config.untracked });
    diffs = [...parseDiff(src.text), ...src.untracked];
    description = src.description;
  }
  const result = analyzeDiffs(diffs, config);
  const failOn = (parseSeverity(flags['fail-on'], 'fail-on', true) ?? config.failOn) as Severity | 'none';
  const minSev = (parseSeverity(flags['min-severity'], 'min-severity') ?? 'low') as Severity;
  const shown = filterMin(result.findings, minSev);
  const failed = meetsThreshold(result.findings, failOn);
  let format = typeof flags.format === 'string' ? flags.format : 'pretty';
  if (flags.json) format = 'json';
  if (flags.sarif) format = 'sarif';
  const elapsedMs = Date.now() - started;
  switch (format) {
    case 'json': process.stdout.write(renderJson(shown, result.stats, description, failed) + '\n'); break;
    case 'sarif': process.stdout.write(renderSarif(shown) + '\n'); break;
    case 'github': {
      const ann = renderGithub(shown);
      if (ann) process.stdout.write(ann + '\n');
      process.stdout.write(renderPretty(shown, result.stats, { c: colors(false), description, failOn, failed, elapsedMs }) + '\n');
      break;
    }
    case 'pretty': {
      const c = colors(shouldColor(process.stdout, typeof flags.color === 'boolean' ? flags.color : undefined));
      process.stdout.write(renderPretty(shown, result.stats, { c, description, failOn, failed, elapsedMs }) + '\n');
      break;
    }
    default: throw new UsageError(`Unknown --format ${format}`);
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  // `fakegreen | head` closes the pipe early; exit quietly instead of crashing.
  process.stdout.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw e;
  });
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e: Error) => {
      const known = e instanceof UsageError || e instanceof GitError || e instanceof ConfigError || (e as NodeJS.ErrnoException).code === 'ENOENT';
      process.stderr.write(`fakegreen: ${known ? e.message : e.stack ?? e.message}\n`);
      process.exitCode = 2;
    },
  );
}

export { main };
