import type { Finding, RuleFn } from '../types';
import { completedToDate, roundCents } from '../helpers';

export const allowanceOverrun: RuleFn = (profile, payApp) => {
  const findings: Finding[] = [];
  if (profile.allowances.length === 0) return findings;

  const allowanceByCode = new Map(profile.allowances.map((a) => [a.code, a]));

  for (const line of payApp.lineItems) {
    if (line.category !== 'allowance') continue;
    const allowance = allowanceByCode.get(line.code);
    if (!allowance) continue;

    const billed = completedToDate(line) + line.materialsPresentlyStored;
    const overage = roundCents(billed - allowance.amount);
    if (overage <= 0) continue;

    findings.push({
      ruleId: 'ALLOWANCE_OVERRUN',
      severity: 'medium',
      title: `Allowance ${line.code} exceeded`,
      affectedLineItems: [line.code],
      dollarExposure: overage,
      contractBasis: `allowances[code="${allowance.code}"].amount = ${allowance.amount}`,
      explanation:
        `Allowance "${allowance.description}" (code ${allowance.code}) is billed at ${roundCents(billed)} ` +
        `against an allowance amount of ${allowance.amount}. Overage = ${overage}.`,
      recommendedAction:
        `Confirm a fully-executed change order exists for the overage. ` +
        `If not, withhold the overage amount pending a change order.`,
      reviewFlagOnly: true,
    });
  }

  return findings;
};
