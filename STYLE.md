# How I write code here

I want this code to read like a person wrote it, without dropping any of the care. These are the rules I hold
myself to. The ones a machine can check are enforced by ESLint and Prettier (`npm run lint`, `npm run format:check`),
and CI goes dark when they drift.

## 1. Names say what the thing is

Use the domain word, not a generic one. `camelCase` for values and functions, `PascalCase` for types,
`UPPER_CASE` only for real module-level constants. One- or two-letter names are fine for tiny scopes
(`l` for a line in a loop body), never for anything that lives longer.

```ts
// bad
const ctx = buildContext(data);
function mk(k, t) {}
// good
const scan = prepareScan(diffs);
function makeLine(kind, text) {}
```

## 2. Comment the why, not the what

If the code already says it, delete the comment. Keep the ones that explain a constraint, a workaround or
a "this looks wrong but isn't". Short and plain, lowercase is fine.

```ts
// bad
// Increment the counter.
count++;
// good
// Git for Windows can hand us CRLF. A stray \r breaks the header regexes.
const lines = input.split(/\r?\n/);
```

## 3. No boilerplate JSDoc

No `/** ... */` blocks that just repeat the signature. Types are the documentation. If a field needs a
note, give it a one-line `//` comment that adds something the type can't.

## 4. Small functions, shallow nesting

A function should fit on a screen: 120 lines max (enforced), nesting 5 deep max (enforced). When a
function repeats the same object shape over and over, pull out a tiny local helper instead.

```ts
// bad: eight copies of { ruleId, severity, file: f, line: l, side: 'added', message, snippet }
// good
const hit = (ruleId: string, severity: Severity, message: string) =>
  flag({ ruleId, severity, file: f, line: l, side: 'added', message, snippet: l.text.trim() });
```

## 5. Errors are typed, expected, and loud

Throw a named error class (`UsageError`, `GitError`, `ConfigError`) for things the user can fix and catch it at
the edge (the CLI), where it becomes a message and exit code 2. Don't swallow errors silently: an empty
`catch {}` is only fine when failing is the normal case (an optional file), and then a comment says so.

```ts
// bad
try { run(); } catch (e) {}
// good
} catch { /* ignore malformed package.json */ }
```

## 6. Types are honest

No `any` in source (enforced). If data really is unknown (a user's JSON file), use `unknown` or a narrow
shape, or disable the rule on that one line with a comment saying why. Type-only imports use
`import { type X }` (enforced).

## 7. File layout

One module per stage (`git`, `diff`, `lang`, `rules/*`, `analyze`, `report/*`), imports at the top, node
built-ins as `node:fs` (enforced), then local modules. Exports first-class, helpers below the code that
uses them. No barrel files beyond `index.ts`.

## 8. Formatting is not a discussion

Prettier decides: 120 columns, single quotes, trailing commas. Don't hand-align, don't fight it.

## 9. No dead weight

No unused variables or imports (enforced), no `TODO`/`FIXME` left in (enforced), no commented-out code,
`const` by default, `===` always (enforced).
