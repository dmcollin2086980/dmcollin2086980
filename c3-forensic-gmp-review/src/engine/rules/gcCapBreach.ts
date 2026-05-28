import type { Finding, RuleFn } from '../types';
import { linesByCategory, roundCents, sumCompletedToDate } from '../helpers';

export const gcCapBreach: RuleFn = (profile, payApp) => {
  const findings: Finding[] = [];
  const gcLines = linesByCategory(payApp.lineItems, 'general_conditions');
  if (gcLines.length === 0) return findings;

  if (profile.gcCapAmount !== undefined) {
    const cumulative = sumCompletedToDate(gcLines);
    const overage = roundCents(cumulative - profile.gcCapAmount);
    if (overage > 0) {
      findings.push({
        ruleId: 'GC_CAP_BREACH',
        severity: 'medium',
        title: 'Cumulative general conditions billings exceed the GC cap',
        affectedLineItems: gcLines.map((l) => l.code),
        dollarExposure: overage,
        contractBasis: `gcCapAmount = ${profile.gcCapAmount}`,
        explanation:
          `Cumulative general conditions billings (completed-to-date) total ${roundCents(cumulative)}, ` +
          `which exceeds the GC cap of ${profile.gcCapAmount} by ${overage}.`,
        recommendedAction:
          `Withhold the overage. Request the contractor's GC backup to confirm cumulative GC spend and ` +
          `the basis for any amounts above the cap.`,
        reviewFlagOnly: true,
      });
    }
  }

  if (profile.gcMonthlyRate !== undefined) {
    const thisPeriod = gcLines.reduce(
      (acc, l) => acc + l.workCompletedThisPeriod,
      0,
    );
    const overage = roundCents(thisPeriod - profile.gcMonthlyRate);
    if (overage > 0) {
      findings.push({
        ruleId: 'GC_CAP_BREACH',
        severity: 'medium',
        title: 'General conditions billed above the contractual monthly rate',
        affectedLineItems: gcLines.map((l) => l.code),
        dollarExposure: overage,
        contractBasis: `gcMonthlyRate = ${profile.gcMonthlyRate}`,
        explanation:
          `General conditions billed this period total ${roundCents(thisPeriod)}, exceeding the ` +
          `contractual monthly rate of ${profile.gcMonthlyRate} by ${overage}.`,
        recommendedAction:
          `Adjust GC billing to the contractual monthly rate, or obtain a written change to the rate.`,
        reviewFlagOnly: true,
      });
    }
  }

  return findings;
};
