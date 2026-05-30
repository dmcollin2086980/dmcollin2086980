import type {
  AuditResult,
  Finding,
  PayApplication,
  ProjectProfile,
  RuleFn,
  Severity,
} from './types';
import { feeOnFee } from './rules/feeOnFee';
import { retainageMiscalc } from './rules/retainageMiscalc';
import { insuranceBondPassthrough } from './rules/insuranceBondPassthrough';
import { contingencyMisuse } from './rules/contingencyMisuse';
import { allowanceOverrun } from './rules/allowanceOverrun';
import { gcCapBreach } from './rules/gcCapBreach';
import { storedMaterialsDoc } from './rules/storedMaterialsDoc';
import { arithmeticIntegrity } from './rules/arithmeticIntegrity';

export const ALL_RULES: RuleFn[] = [
  feeOnFee,
  retainageMiscalc,
  insuranceBondPassthrough,
  contingencyMisuse,
  allowanceOverrun,
  gcCapBreach,
  storedMaterialsDoc,
  arithmeticIntegrity,
];

const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export const runAudit = (
  profile: ProjectProfile,
  payApp: PayApplication,
  rules: RuleFn[] = ALL_RULES,
): AuditResult => {
  const findings: Finding[] = rules.flatMap((rule) => rule(profile, payApp));

  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    return b.dollarExposure - a.dollarExposure;
  });

  const counts = { high: 0, medium: 0, low: 0 };
  let totalExposure = 0;
  for (const f of findings) {
    counts[f.severity] += 1;
    if (f.severity === 'high' || f.severity === 'medium') {
      totalExposure += f.dollarExposure;
    }
  }
  totalExposure = Math.round(totalExposure * 100) / 100;

  return { findings, totalExposure, counts };
};
