# C3 Forensic GMP Review

Forensic audit of GMP contractor pay applications (AIA G702 / G703 style) against the project's contract terms.

This directory holds the v1 build. See [`docs/v1-spec.md`](docs/v1-spec.md) for the full spec and [`docs/v1-spec-addendum.md`](docs/v1-spec-addendum.md) for the authoritative addendum (locked product name, user-tagged fee base, CSV import contract).

## Status

**M1 — Engine core: complete.**
**M2a — CSV / paste import: complete.** Pure-TS parser for the addendum's CSV contract; structured errors and warnings; output feeds directly into `runAudit`.
**M2b — UI scaffold + Project Profile form: complete.** Vite + React 19 + Tailwind v4. `npm run dev` boots the app; the Profile form covers all GMP fields with JSON export / import.
**M2c — Pay Application entry + CSV import UI: complete.** Tabbed nav between Profile and Pay App. The Pay App page has CSV/paste import (with preview + structured error reporting), a G702 summary form, and a G703 line grid with add/remove rows.
**M3a — Findings view: complete.** Third tab runs `runAudit` against the live profile + payApp and renders the severity-ranked findings as cards with formatted USD exposure, contract basis, affected lines, explanation, and recommended action.
**M3b — Markdown exposure memo: complete.** Deterministic `buildMarkdownMemo()` turns the audit into a full memo (header, summary, findings table, per-finding narrative for high+medium, required disclaimer). The Findings tab adds an Exposure memo section with Prepared by, Copy, and Download .md buttons.

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

Pending: PDF export, M4 paywall (license-key gate), M5 polish (privacy messaging, JSON save/load).

## Develop

```bash
cd c3-forensic-gmp-review
npm install
npm run dev        # http://localhost:5173 — Project profile form
npm run typecheck
npm test
npm run build      # Vite production build into dist/
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
  state/
    profile.ts              defaultProfile, profileToJson, parseProfileJson, slugify
    payApp.ts               defaultPayApp, emptyLineItem, LINE_CATEGORIES, fee-basis helpers
    __tests__/profile.test.ts, payApp.test.ts
  components/
    Field.tsx               small Tailwind-styled input/label primitives
    ProjectProfileForm.tsx  the GMP profile form (JSON export + import)
    PayAppEntry.tsx         the pay app page (CSV import + G702 form + G703 grid)
    CsvImport.tsx           wraps parsePayAppCsv with file upload + paste + preview
    FindingsView.tsx        runs runAudit (useMemo) and renders the findings cards
    MemoPreview.tsx         preparedBy input + memo preview + copy / download buttons
    __tests__/              ProjectProfileForm, PayAppEntry, CsvImport, FindingsView, MemoPreview
  memo/
    buildMarkdownMemo.ts    pure: AuditResult -> Markdown memo with required disclaimer
    __tests__/buildMarkdownMemo.test.ts
  App.tsx                   app shell with Profile / Pay app / Findings tabs
  main.tsx                  React mount
  styles.css                @import "tailwindcss";
```

The engine is framework-agnostic: pure TypeScript, no DOM, no network. The UI (M2b) consumes it through `parsePayAppCsv(text)` and `runAudit(profile, payApp)`.

## Liability guardrails

Per spec Section 12: every finding is a flag for review, not a legal conclusion. The engine never invents contract terms; missing optional terms simply do not fire a rule. The generated memo (M3) will carry the required disclaimer block.
