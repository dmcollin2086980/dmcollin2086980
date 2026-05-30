// The sample CSV from v1-spec-addendum.md Section C, verbatim. Used as
// the canonical happy-path fixture. Mirrors the engine's clean fixture.
export const SAMPLE_CSV = `code,description,scheduled_value,work_completed_previous,work_completed_this_period,materials_presently_stored,category,retainage_withheld,fee_basis_categories
COW-01,General construction,3000000,1000000,200000,0,cost_of_work,,
GC-01,General conditions,300000,100000,20000,0,general_conditions,,
FEE-01,Contractor fee,150000,50000,10000,0,fee,,cost_of_work
ALLOW-01,Signage allowance,25000,0,0,0,allowance,,
INS-01,Insurance,40000,10000,5000,0,insurance,,
BOND-01,Payment & performance bond,40000,40000,0,0,bond,,
`;

// Same content, tab-delimited. Mimics a paste from a spreadsheet.
export const SAMPLE_TSV = SAMPLE_CSV.replace(/,/g, '\t');
