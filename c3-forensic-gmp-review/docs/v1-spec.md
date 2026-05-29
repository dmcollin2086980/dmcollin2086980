# GMP Forensic Auditor — Version 1 Build Spec

**Working title:** GMP Forensic Auditor (rename TBD; candidates: LedgerGuard, DrawCheck, OwnerAudit)
**Owner:** C3 (Collinsworth Construction Consulting)
**Audience for this doc:** an AI coding agent (Claude Code) building v1 from scratch
**Status:** v1 planning / pre-build
**Last updated:** 2026-05-28

> **Note:** Section A of `v1-spec-addendum.md` locks the product name as **C3 Forensic GMP Review**. The addendum is authoritative where it conflicts with this document.

-----

## 1. Objective

Build a web application that lets an owner, owner's representative, or construction attorney audit a contractor's progress payment application (AIA G702 / G703 style) against the project's GMP contract terms and automatically flag billing irregularities with an estimated dollar exposure, a severity rank, and the contract basis for each flag.

The product productizes a manual forensic workflow: comparing what a GC billed against what the GMP contract actually permits, and catching fee-on-fee, retainage errors, insurance/bond passthrough markups, contingency misuse, allowance overruns, GC cap breaches, undocumented stored materials, and arithmetic errors.

**One-line value prop:** "Catch what the contractor billed that the contract does not allow, in minutes, with a memo you can send."

-----

## 2. v1 Scope and Non-Goals

### In scope (v1)

- Single project at a time (one Project Profile = one GMP contract).
- Manual and CSV/paste entry of pay application line items (G703) and summary (G702).
- A deterministic rules engine implementing the 8 forensic checks in Section 5.
- Findings output: severity-ranked table with dollar exposure and contract citation.
- An invoice-style exposure memo, exportable to PDF and Markdown.
- Freemium gating (Section 8).
- Client-side-only data handling (no financial data leaves the browser in v1).

### Explicit non-goals (defer to later versions)

- OCR / automated PDF parsing of pay apps (v2).
- Change order forensic analysis (v2 module).
- Regulatory compliance checking, ICRA/ILSM/FGI/NFPA (separate product line).
- Multi-project portfolio dashboard (v1.2).
- User accounts, cloud storage, team collaboration (v1.1).
- Stripe billing integration (v1.1; v1 uses a simple license-key gate).
- Schedule/delay analysis.

**Design rule:** if a feature is not required to prove "we found real money the GC over-billed," it is out of v1.

-----

## 3. Core Concept and Data Flow

```
Project Profile (GMP terms, entered once)
        +
Pay Application (entered per billing period)
        |
        v
Deterministic Rules Engine (pure functions, no LLM)
        |
        v
Findings (severity, $ exposure, contract citation, recommended action)
        |
        v
Exposure Memo (invoice-style narrative) + Findings Table -> export
```

The user defines the contract once, then runs each monthly pay app against it. Each run produces a self-contained findings set and memo.

-----

## 4. Data Model

All types in TypeScript. These are the canonical shapes the engine consumes.

```ts
// Entered once per project
interface ProjectProfile {
  projectName: string;
  contractType: 'A102_A201' | 'A133_A201' | 'custom';
  gmpAmount: number;

  // Fee
  feePercent: number;              // e.g. 0.05
  feeBase: FeeBaseDefinition;      // what the fee is allowed to be applied to

  // Retainage
  retainagePercent: number;        // e.g. 0.05 or 0.10
  retainageOnStoredMaterials: boolean;
  retainageReductionAtPercent?: number; // e.g. reduce to 0 at 50% complete
  retainageReleasedLineItems?: string[]; // line item codes released from retainage

  // General Conditions
  gcCapAmount?: number;            // total GC cap if lump/capped
  gcMonthlyRate?: number;          // if billed monthly at a set rate

  // Contingency
  ownerContingencyAmount?: number;
  gcContingencyAmount?: number;
  contingencyRequiresAuthorization: boolean;

  // Allowances
  allowances: Allowance[];

  // Insurance & bonds (passthrough treatment)
  insurancePassthroughAtCost: boolean; // true = no fee/markup allowed on insurance
  bondPassthroughAtCost: boolean;

  // Excluded cost-of-work items (contract-excluded, should not appear as cost)
  excludedCostItems: string[];     // free-text keywords, e.g. "home office overhead"

  notes?: string;
}

interface FeeBaseDefinition {
  appliesToCostOfWork: boolean;        // typically true
  appliesToGeneralConditions: boolean; // typically false -> fee-on-fee risk if billed
  appliesToContingency: boolean;       // typically false
  appliesToInsurance: boolean;         // typically false
  appliesToBond: boolean;              // typically false
}

interface Allowance {
  code: string;
  description: string;
  amount: number;
}

// Entered per billing period
interface PayApplication {
  applicationNumber: number;
  periodTo: string;                // ISO date
  lineItems: PayAppLineItem[];
  // G702 summary fields as billed by the GC (for cross-check against computed)
  reportedTotalCompletedAndStored: number;
  reportedRetainage: number;
  reportedTotalEarnedLessRetainage: number;
  reportedLessPreviousCertificates: number;
  reportedCurrentPaymentDue: number;
}

interface PayAppLineItem {
  code: string;
  description: string;
  scheduledValue: number;
  workCompletedPrevious: number;   // from prior applications
  workCompletedThisPeriod: number;
  materialsPresentlyStored: number;
  category: LineCategory;          // user-tagged so the engine knows how to treat it
  retainageWithheld?: number;      // as billed, if line-level retainage present
}

type LineCategory =
  | 'cost_of_work'
  | 'general_conditions'
  | 'fee'
  | 'contingency_owner'
  | 'contingency_gc'
  | 'allowance'
  | 'insurance'
  | 'bond'
  | 'stored_materials'
  | 'other';

interface Finding {
  ruleId: string;                  // e.g. 'FEE_ON_FEE'
  severity: 'high' | 'medium' | 'low';
  title: string;
  affectedLineItems: string[];     // codes
  dollarExposure: number;          // estimated over-billing / improper amount
  contractBasis: string;           // which profile field/clause this relies on
  explanation: string;             // plain-English, deterministic template
  recommendedAction: string;
  reviewFlagOnly: true;            // always true: advisory, never a legal conclusion
}
```

-----

## 5. The Rules Engine (the heart of v1)

Implement as a set of **pure functions**, one per rule, each taking `(profile: ProjectProfile, payApp: PayApplication)` and returning `Finding[]`. No network calls, no LLM, fully deterministic and unit-testable. A runner aggregates all findings.

For every rule: if a required profile field is missing, return an informational finding ("cannot evaluate, contract term not provided") rather than a false positive.

### Rule 1 — FEE_ON_FEE (severity: high)

Detect contractor fee applied to a base the contract excludes.

- For each line categorized `fee`, infer the implied fee base from the period's billed amounts.
- If `feeBase.appliesToGeneralConditions === false` but fee appears computed on a base that includes GC line totals, flag the delta.
- Same logic for contingency, insurance, bond.
- Dollar exposure = improperly-included base x feePercent.

### Rule 2 — RETAINAGE_MISCALC (severity: high)

- Recompute expected retainage = retainagePercent x (completed + stored, subject to profile rules).
- If `retainageOnStoredMaterials === false`, exclude stored materials from the retainage base.
- If `retainageReductionAtPercent` is reached, expected retainage steps down accordingly.
- Compare to `reportedRetainage`. Flag any over-withholding (owner's cash improperly held) OR under-withholding. Dollar exposure = absolute delta.
- (Note: over-withholding is the CQCH-style finding; surface both directions.)

### Rule 3 — INSURANCE_BOND_PASSTHROUGH (severity: high)

- For lines categorized `insurance` or `bond`: if profile says passthrough at cost, no fee or markup is allowed.
- Flag if a fee line's base includes these, or if markup is detectable.
- Dollar exposure = markup/fee improperly applied to insurance + bond.

### Rule 4 — CONTINGENCY_MISUSE (severity: medium)

- Flag draws against `contingency_owner` or `contingency_gc` lines in the current period if `contingencyRequiresAuthorization === true` (prompt user: was a written authorization issued?).
- Flag fee billed on contingency draws when `feeBase.appliesToContingency === false`.
- Dollar exposure = contingency drawn this period flagged for authorization + any fee improperly applied.

### Rule 5 — ALLOWANCE_OVERRUN (severity: medium)

- For each `allowance` line, compare cumulative completed against the profile allowance amount.
- Flag any line billed beyond its allowance with no corresponding change order (prompt user to confirm CO existence).
- Dollar exposure = amount over allowance.

### Rule 6 — GC_CAP_BREACH (severity: medium)

- Sum cumulative `general_conditions` billings.
- If `gcCapAmount` is set and cumulative exceeds it, flag the overage.
- If `gcMonthlyRate` is set, flag any monthly GC billing above the rate.
- Dollar exposure = overage.

### Rule 7 — STORED_MATERIALS_DOC (severity: low)

- For any line with `materialsPresentlyStored > 0`, raise a documentation checklist flag: invoice/bill of sale, transfer of title, insurance on stored materials, off-site storage agreement if applicable.
- Dollar exposure = stored materials amount at risk if undocumented (informational, not an over-billing claim).

### Rule 8 — ARITHMETIC_INTEGRITY (severity: high)

- Recompute each G703 line: completed-to-date = previous + this period; balance to finish = scheduled value - completed - stored; percent complete.
- Recompute G702 rollups and compare to the reported summary fields.
- Flag any line where billed totals do not tie, and any G702 summary that does not equal the sum of lines.
- Dollar exposure = the discrepancy amount.

**Aggregation:** the runner returns all findings sorted by severity (high -> low), then by dollar exposure descending. Compute a `totalExposure` across high+medium findings.

-----

## 6. Output: Exposure Memo

Generate an invoice-style narrative memo from the findings. Single integrated document, professional tone, no em dashes. Structure:

1. **Header:** project name, pay application number, period, prepared-by/date.
2. **Summary statement:** one paragraph stating total estimated exposure and number of findings by severity.
3. **Findings table:** severity, title, affected lines, dollar exposure, contract basis, recommended action.
4. **Per-finding narrative:** for each high/medium finding, the deterministic explanation and the contract clause it relies on.
5. **Disclaimer block (required):** states the analysis is an advisory review of flags for the owner's consideration, is not a legal determination, and that contract interpretation should be confirmed with counsel and the project record.

Export targets: PDF and Markdown. (Branding pass with CORE/C3 styling is a later add; v1 can be clean default styling.)

-----

## 7. Architecture and Tech Stack

- **Form factor:** web app (table/document heavy; desktop-first responsive).
- **Stack:** React + TypeScript, Vite, Tailwind CSS.
- **Privacy model (v1):** fully client-side. No backend, no data transmission. Pay-app financials stay in the browser. This is a stated feature, not just an implementation choice. Persist in-session state in memory; allow explicit local JSON export/import of a Project Profile so users can save and reload work without a server. (Do not rely on localStorage as the primary store; offer file export/import.)
- **Engine:** pure TypeScript module (`/src/engine`), framework-agnostic, 100% unit tested with a fixtures-based test suite.
- **Memo generation:** deterministic template module; PDF via a client-side library (e.g. react-pdf or html-to-pdf approach).
- **Optional later (NOT v1 core):** an LLM-assisted "rewrite this memo in plain English / draft a demand letter tone" button. Keep it strictly separate from detection.

### Suggested structure

```
/src
  /engine
    rules/feeOnFee.ts ... arithmeticIntegrity.ts
    runner.ts
    types.ts
    __tests__/   (one fixture suite per rule)
  /memo
    buildMemo.ts
    exportPdf.ts
  /components
    ProjectProfileForm.tsx
    PayAppEntry.tsx          (manual + CSV/paste import)
    FindingsTable.tsx
    MemoPreview.tsx
    Paywall.tsx
  App.tsx
```

-----

## 8. Monetization (v1 freemium gate)

- **Free tier:** run the full engine; show the number of findings and their severity ranks; show titles and which rules fired. Dollar exposure values are blurred/locked. Memo export disabled.
- **Paid tier:** unlock dollar exposure figures and full memo export (PDF/Markdown).
- **v1 mechanism:** a simple license-key gate (a key unlocks the paid features client-side). Real accounts and Stripe metered/subscription billing are v1.1.
- **Pricing to validate (not built in v1):** per-audit credit vs monthly subscription for owners' reps. Leave a TODO hook for the billing layer.

-----

## 9. Build Milestones

1. **M1 — Engine core:** types, the 8 rule functions, runner, full unit test suite against handcrafted fixtures (including known-bad pay apps that should fire each rule). Definition of done: all rules pass tests, zero false positives on a clean control fixture.
2. **M2 — Input UI:** Project Profile form + Pay App entry (manual and CSV/paste). Validation and friendly missing-field handling.
3. **M3 — Findings + memo:** findings table, memo builder, PDF/Markdown export.
4. **M4 — Paywall gate:** free/paid boundary and license-key unlock.
5. **M5 — Polish + privacy messaging:** local JSON save/load, disclaimer, responsive layout, "data never leaves your browser" messaging.

-----

## 10. Acceptance Criteria (v1 done)

- A user can define a GMP Project Profile and enter a pay application by hand or via CSV/paste.
- Running the audit produces severity-ranked findings, each with a dollar exposure and a contract basis citation.
- A control (clean) pay app produces zero high/medium findings (no false positives).
- A seeded bad pay app fires the expected rules with correct dollar math (verified by tests mirroring real findings: e.g. an over-withheld retainage scenario and an insurance fee-on-fee scenario).
- The exposure memo exports to PDF and Markdown with the disclaimer present.
- Free tier hides dollar values and export; license key unlocks them.
- No financial data is transmitted off the client.

-----

## 11. Open Questions (resolve before/early in build)

1. Product name and domain.
2. CSV column contract: define the exact import schema for G703 lines, or build a guided paste mapper.
3. Pricing model to validate: per-audit credits vs subscription (affects v1.1 billing design, not v1 engine).
4. How much contract nuance to support in v1 FeeBaseDefinition before it becomes a config burden (start minimal).
5. Memo tone presets: neutral advisory only for v1, or also a firmer "for dispute" tone (recommend neutral only for v1 to limit liability surface).

-----

## 12. Liability / Positioning Guardrails (non-negotiable)

- Every finding is a flag for review, never a legal conclusion.
- The memo always carries the disclaimer block.
- The engine never invents contract terms; missing terms yield "cannot evaluate," not a guess.
- Market positioning: owner-side decision support, not legal advice.
