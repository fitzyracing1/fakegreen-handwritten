import { ResolvedConfig } from './config';
import { filePath } from './diff';
import { matchesAny } from './glob';
import { fileKind, findDirective, flavorOf, Flavor, isConfigFile, isTestPath, isTestSupportPath, langOf, lexLine, newLexState } from './lang';
import { DiffLine, FileDiff, FileKind, Finding, Hunk, Lang, Severity } from './types';

export interface ChangedFile {
  path: string;
  diff: FileDiff;
  lang: Lang;
  kind: FileKind;
  flavor: Flavor;
  isTest: boolean;
  isTestSupport: boolean;
  isConfig: boolean;
  added: DiffLine[];
  removed: DiffLine[];
  ignoreFile: boolean;
}

export interface Scan {
  files: ChangedFile[];
  config: ResolvedConfig;
  // line -> count, so we can tell moved code from deleted code
  removedText: Map<string, number>;
  addedText: Map<string, number>;
}

export interface Hit {
  ruleId: string;
  severity: Severity;
  file: ChangedFile;
  line?: DiffLine;
  lineNo?: number;
  hunk?: Hunk;
  side: Finding['side'];
  message: string;
  snippet?: string;
}

export function prepareScan(diffs: FileDiff[], config: ResolvedConfig): Scan {
  const files: ChangedFile[] = [];
  const removedText = new Map<string, number>();
  const addedText = new Map<string, number>();
  for (const d of diffs) {
    if (d.binary) continue;
    const p = filePath(d);
    if (matchesAny(p, config.ignore)) continue;
    const kind = fileKind(p);
    if (kind === 'skip') continue;
    const lang = langOf(p);
    const flavor = flavorOf(p, lang, kind);
    const entry: ChangedFile = {
      path: p,
      diff: d,
      lang,
      kind,
      flavor,
      isTest: isTestPath(p, config.testPatterns) || (d.oldPath ? isTestPath(d.oldPath, config.testPatterns) : false),
      isTestSupport: isTestSupportPath(p),
      isConfig: isConfigFile(p),
      added: [],
      removed: [],
      ignoreFile: false,
    };
    for (const h of d.hunks) {
      // old and new side each get their own lexer state, otherwise an
      // unclosed block comment on one side leaks into the other
      const oldSt = newLexState();
      const newSt = newLexState();
      for (const l of h.lines) {
        if (l.kind === '-') {
          Object.assign(l, lexLine(l.text, lang, flavor, oldSt));
        } else if (l.kind === '+') {
          Object.assign(l, lexLine(l.text, lang, flavor, newSt));
        } else {
          Object.assign(l, lexLine(l.text, lang, flavor, newSt));
          lexLine(l.text, lang, flavor, oldSt);
        }
        if (l.kind === '+') entry.added.push(l);
        if (l.kind === '-') entry.removed.push(l);
        if (l.kind !== '-' && findDirective(flavor === 'none' ? l.text : (l.comment ?? ''))?.file) entry.ignoreFile = true;
      }
    }
    for (const l of entry.removed) countLine(removedText, squashSpaces(l.text));
    for (const l of entry.added) countLine(addedText, squashSpaces(l.text));
    files.push(entry);
  }
  return { files, config, removedText, addedText };
}

export function squashSpaces(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function countLine(m: Map<string, number>, k: string) {
  if (!k) return;
  m.set(k, (m.get(k) ?? 0) + 1);
}

export function isMovedLine(scan: Scan, l: DiffLine): boolean {
  const k = squashSpaces(l.text);
  if (!k) return false;
  if (l.kind === '+') return (scan.removedText.get(k) ?? 0) > 0;
  return (scan.addedText.get(k) ?? 0) > 0;
}

export function newSide(h: Hunk): DiffLine[] {
  return h.lines.filter((l) => l.kind !== '-');
}

export function hunkOf(f: ChangedFile, line: DiffLine): Hunk | undefined {
  return f.diff.hunks.find((h) => h.lines.includes(line));
}

// removed lines have no new-side number, so point at the closest line that does
export function anchorFor(f: ChangedFile, line: DiffLine): number | undefined {
  if (line.newNo !== undefined) return line.newNo;
  if (f.diff.status === 'deleted') return line.oldNo;
  const h = hunkOf(f, line);
  if (!h) return line.oldNo;
  const idx = h.lines.indexOf(line);
  for (let i = idx + 1; i < h.lines.length; i++) if (h.lines[i].newNo !== undefined) return h.lines[i].newNo;
  for (let i = idx - 1; i >= 0; i--) if (h.lines[i].newNo !== undefined) return h.lines[i].newNo;
  return Math.max(1, h.newStart);
}
