# C3 Forensic GMP Review — v1 Spec Addendum

This addendum resolves three open questions from the v1 build spec and is authoritative where it conflicts with the original spec. Hand off both documents to Claude Code.

**Last updated:** 2026-05-28

-----

## A. Product name (locked)

The product is **C3 Forensic GMP Review**. Use this exact name in the UI title, package name, document headers, and the generated memo header. Retire the working titles (LedgerGuard, DrawCheck, OwnerAudit).

-----

## B. Fee base is user-tagged, not inferred (model change)

The engine must NOT infer what the contractor's fee was calculated on. Instead, the pay application declares it explicitly, and the engine compares the declared (tagged) base against the contractually-allowed base in the Project Profile.

### Data model change

Add two optional fields to `PayAppLineItem`, used only on lines with `category === 'fee'`:

```ts
interface PayAppLineItem {
  // ... existing fields ...
  feeBasisCategories?: LineCategory[]; // fee lines only: the categories the GC's billed fee was applied to
  feeBilledThisPeriod?: number;        // fee lines only: optional explicit fee billed this period
}
```

`feeBasisCategories` is the user's tag of what the GC included in its fee base. Example: a clean fee is `['cost_of_work']`. A fee-on-fee situation is `['cost_of_work', 'general_conditions']`.

### Fee logic division (prevents double-counting)

The original spec let Rule 1 cover GC, contingency, insurance, and bond. That overlapped Rule 3. Final division:

- **Rule 1 FEE_ON_FEE** owns `general_conditions` and `contingency_owner` / `contingency_gc`. It fires when `feeBasisCategories` includes any of these and the Project Profile disallows them (`feeBase.appliesToGeneralConditions === false` or `feeBase.appliesToContingency === false`).
- **Rule 3 INSURANCE_BOND_PASSTHROUGH** owns `insurance` and `bond`. It fires when `feeBasisCategories` includes either and the Profile marks them passthrough-at-cost (`insurancePassthroughAtCost === true` or `bondPassthroughAtCost === true`).

### Exposure formula (both rules)

For each disallowed category tagged in `feeBasisCategories`:

```
exposure += feePercent * (completed_to_date of all lines in that category)
```

where `completed_to_date = work_completed_previous + work_completed_this_period` summed across lines of that category. Use completed-to-date (not just this period) so the finding reflects cumulative improper fee. Each finding cites the specific Profile field it relies on.

-----

## C. CSV / paste import contract

Support both file upload (.csv) and clipboard paste through one shared column contract. The import covers the G703 line grid only. The five G702 summary fields are entered in the form, not imported, in v1.

### Required header row (exact, lowercase, snake_case)

```
code,description,scheduled_value,work_completed_previous,work_completed_this_period,materials_presently_stored,category,retainage_withheld,fee_basis_categories
```

### Column definitions

| Column                       | Type   | Required    | Notes                                                                                                                                 |
| ---------------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| code                         | string | yes         | Unique per pay app. Duplicate codes are a hard error.                                                                                 |
| description                  | string | no          | Free text.                                                                                                                            |
| scheduled_value              | number | yes         | See number normalization below.                                                                                                       |
| work_completed_previous      | number | yes         | Cumulative from prior applications.                                                                                                   |
| work_completed_this_period   | number | yes         | This period only.                                                                                                                     |
| materials_presently_stored   | number | yes         | Use 0 if none.                                                                                                                        |
| category                     | enum   | yes         | One of: cost_of_work, general_conditions, fee, contingency_owner, contingency_gc, allowance, insurance, bond, stored_materials, other |
| retainage_withheld           | number | no          | Line-level retainage as billed, if present. Blank allowed.                                                                            |
| fee_basis_categories         | string | conditional | Required only on `fee` lines. Pipe-delimited categories, e.g. `cost_of_work\|general_conditions`. Blank/ignored on non-fee lines.     |

### Number normalization

Strip `$`, thousands separators (commas), and whitespace before parsing. Treat parentheses as negative (e.g. `(1,200)` becomes `-1200`). Empty numeric cell on a required column is a hard error; on an optional column it becomes 0 or undefined per the type.

### Paste behavior

- Accept paste of the same columns. Auto-detect delimiter: if any row contains a tab, treat as tab-delimited (spreadsheet paste); otherwise comma.
- The first non-empty pasted row must be the header row, matched case-insensitively against the contract above.
- Show a preview table after parse, before the user commits, so they can catch a bad mapping.

### Validation rules (hard errors, block import, report by row number)

1. Missing or misordered header row.
2. Unknown `category` value.
3. Non-numeric value in a numeric column after normalization.
4. Duplicate `code`.
5. A `fee` line with empty `fee_basis_categories`.
6. `fee_basis_categories` containing an unknown category token.

### Soft warnings (allow import, surface to user)

1. A non-fee line that has a non-empty `fee_basis_categories` (will be ignored).
2. `work_completed_previous + work_completed_this_period + materials_presently_stored` exceeds `scheduled_value` on a line (possible over-billing; the engine will still evaluate it).

### Sample valid CSV

```
code,description,scheduled_value,work_completed_previous,work_completed_this_period,materials_presently_stored,category,retainage_withheld,fee_basis_categories
COW-01,General construction,3000000,1000000,200000,0,cost_of_work,,
GC-01,General conditions,300000,100000,20000,0,general_conditions,,
FEE-01,Contractor fee,150000,50000,10000,0,fee,,cost_of_work
ALLOW-01,Signage allowance,25000,0,0,0,allowance,,
INS-01,Insurance,40000,10000,5000,0,insurance,,
BOND-01,Payment & performance bond,40000,40000,0,0,bond,,
```
