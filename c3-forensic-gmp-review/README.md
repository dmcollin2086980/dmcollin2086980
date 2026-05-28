# C3 Forensic GMP Review

Forensic audit of GMP contractor pay applications (AIA G702 / G703 style) against the project's contract terms.

This directory holds the v1 build. See [`docs/v1-spec.md`](docs/v1-spec.md) for the full spec and [`docs/v1-spec-addendum.md`](docs/v1-spec-addendum.md) for the authoritative addendum (locked product name, user-tagged fee base, CSV import contract).

## Status

**M1 — Engine core: complete.**
**M2a — CSV / paste import: complete.** Pure-TS parser for the addendum's CSV contract; structured errors and warnings; output feeds directly into `runAudit`.

The deterministic rules engine implements the 8 forensic checks from spec Section 5, with the addendum's fee-logic division applied:

| Rule                          | Severity | Owner                                       |
| ----------------------------- | -------- | ------------------------------------------- |
| `FEE_ON_FEE`                  | high     | GC + contingency (per addendum Section B)   |
| `RETAINAGE_MISCALC`           | high     | over- and under-withholding                 |
| `INSURANCE_BOND_PASSTHROUGH`  | high     | insurance + bond (per addendum Section B)   |
| `CONTINGENCY_MISUSE`          | medium   | authorization-required draws                |
| `ALLOWANCE_OVERRUN`           | medium   | overrun vs profile amount                   |
| `GC_CAP_BREACH`               | medium   | cumulative cap and monthly rate             |
| `STORED_MATERIALS_DOC`        | low      | documentation checklist (informational)     |
| `ARITHMETIC_INTEGRITY`        | high     | G702 rollup integrity vs G703 line totals   |

Pending: M2b/M2c input UI, M3 findings table + memo export, M4 paywall, M5 polish.

## Develop

```bash
cd c3-forensic-gmp-review
npm install
npm run typecheck
npm test
```

## Layout

```
src/
  index.ts                  project-level barrel (engine + import)
  engine/
    types.ts                shared TypeScript types
    helpers.ts              small numeric / lookup utilities
    rules/                  one pure function per rule
    runner.ts               aggregates findings, sorts, totals exposure
    index.ts                engine-only barrel
    __tests__/
      fixtures.ts           clean Profile + clean PayApp (matches addendum's sample CSV)
      *.test.ts             one suite per rule plus a runner suite
  import/
    csv.ts                  parsePayAppCsv: text -> PayAppLineItem[] + ImportIssue[]
    __tests__/
      fixtures.ts           addendum sample CSV (and its TSV form)
      csv.test.ts
```

The engine is framework-agnostic: pure TypeScript, no DOM, no network. The UI layers (M2b onwards) will consume it through `parsePayAppCsv(text)` and `runAudit(profile, payApp)`.

## Liability guardrails

Per spec Section 12: every finding is a flag for review, not a legal conclusion. The engine never invents contract terms; missing optional terms simply do not fire a rule. The generated memo (M3) will carry the required disclaimer block.
