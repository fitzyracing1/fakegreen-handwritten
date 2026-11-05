import { type ResolvedConfig } from './config';
import { anchorFor, prepareScan, type Hit, type Scan } from './context';
import { parseDiff } from './diff';
import { assertionChanges, assertionsRemoved } from './rules/assertions';
import { ciRules } from './rules/ci';
import { RULE_IDS, RULES } from './rules/registry';
import { errorSwallowed, testEnvSpecialCase } from './rules/source';
import { suppressions } from './rules/suppressions';
import { skipsAndFocus, testCountDropped, testFileDeleted } from './rules/tests';
import { findDirective } from './lang';
import { type DiffLine, type FileDiff, type Finding, SEVERITY_RANK, type Severity } from './types';

export interface ScanStats {
  files: number;
  analyzedFiles: number;
  added: number;
  removed: number;
}

export interface ScanResult {
  findings: Finding[];
  stats: ScanStats;
}

// Parse the rule list (if any) of a fakegreen-ignore directive; null means "all rules".
function ignoredRules(text: string): Set<string> | null | undefined {
  const d = findDirective(text);
  if (!d || d.file) return undefined;
  const ids = (d.rest.match(/[a-z][a-z-]+[a-z]/g) ?? []).filter((t) => RULE_IDS.has(t));
  return ids.length ? new Set(ids) : null;
}

// Directives only count inside comments (string literals mentioning fakegreen-ignore are not waivers).
export function directiveText(l: DiffLine, flavor: string): string {
  return flavor === 'none' ? l.text : (l.comment ?? '');
}

function suppressedBy(text: string, ruleId: string): boolean {
  const r = ignoredRules(text);
  if (r === undefined) return false;
  return r === null || r.has(ruleId);
}

function isInlineIgnored(d: Hit): boolean {
  if (d.ruleId === 'ignore-comment-added') return false;
  if (d.file.ignoreFile) return true;
  if (!d.line) return false;
  const hunk = d.file.diff.hunks.find((h) => h.lines.includes(d.line as DiffLine));
  if (d.side === 'added' || d.line.kind !== '-') {
    if (suppressedBy(directiveText(d.line, d.file.flavor), d.ruleId)) return true;
    if (!hunk) return false;
    const idx = hunk.lines.indexOf(d.line);
    for (let i = idx - 1; i >= 0; i--) {
      const p = hunk.lines[i];
      if (p.kind === '-') continue;
      return suppressedBy(directiveText(p, d.file.flavor), d.ruleId);
    }
    return false;
  }
  // for a removed line, the waiver can sit on any added line in the same hunk
  return !!hunk && hunk.lines.some((l) => l.kind === '+' && suppressedBy(directiveText(l, d.file.flavor), d.ruleId));
}

export function runRules(scan: Scan): Finding[] {
  const drafts: Hit[] = [];
  const flag = (d: Hit) => drafts.push(d);
  testFileDeleted(scan, flag);
  testCountDropped(scan, flag);
  skipsAndFocus(scan, flag);
  assertionsRemoved(scan, flag);
  assertionChanges(scan, flag);
  suppressions(scan, flag);
  ciRules(scan, flag);
  testEnvSpecialCase(scan, flag);
  errorSwallowed(scan, flag);

  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const setting = scan.config.rules[d.ruleId];
    if (setting === 'off') continue;
    if (isInlineIgnored(d)) continue;
    const severity: Severity = setting ?? d.severity;
    const line = d.lineNo ?? (d.line ? anchorFor(d.file, d.line) : undefined);
    const key = `${d.ruleId}|${d.file.path}|${line}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f: Finding = { ruleId: d.ruleId, severity, file: d.file.path, side: d.side, message: d.message };
    if (line !== undefined) f.line = line;
    if (d.snippet) {
      // single-line snippets get a +/- marker; multi-line ones come with their own
      let snip = d.snippet.includes('\n') ? d.snippet : `${d.side === 'added' ? '+' : '-'} ${d.snippet}`;
      if (snip.length > 240) snip = snip.slice(0, 237) + '...';
      f.snippet = snip;
    }
    out.push(f);
  }
  return sortFindings(out);
}

export function sortFindings(fs: Finding[]): Finding[] {
  return fs.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export function analyzeDiffs(diffs: FileDiff[], config: ResolvedConfig): ScanResult {
  const scan = prepareScan(diffs, config);
  const findings = runRules(scan);
  let added = 0;
  let removed = 0;
  for (const d of diffs)
    for (const h of d.hunks)
      for (const l of h.lines) {
        if (l.kind === '+') added++;
        else if (l.kind === '-') removed++;
      }
  return { findings, stats: { files: diffs.length, analyzedFiles: scan.files.length, added, removed } };
}

export function analyzeDiffText(text: string, config: ResolvedConfig, extra: FileDiff[] = []): ScanResult {
  return analyzeDiffs([...parseDiff(text), ...extra], config);
}

export function meetsThreshold(findings: Finding[], failOn: Severity | 'none'): boolean {
  if (failOn === 'none') return false;
  return findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]);
}

export { RULES };
