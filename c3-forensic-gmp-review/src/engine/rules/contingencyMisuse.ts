import type { Finding, LineCategory, RuleFn } from '../types';
import { roundCents } from '../helpers';

// Per addendum Section B, fee-on-contingency is owned by Rule 1 (FEE_ON_FEE).
// Rule 4's remaining concern is authorization for contingency draws.
const BUCKETS: ReadonlyArray<{
  category: LineCategory;
  label: string;
  ownerLabel: string;
  amountField: 'ownerContingencyAmount' | 'gcContingencyAmount';
}> = [
  {
    category: 'contingency_owner',
    label: "owner's contingency",
    ownerLabel: "Owner's",
    amountField: 'ownerContingencyAmount',
  },
  {
    category: 'contingency_gc',
    label: "contractor's contingency",
    ownerLabel: "Contractor's",
    amountField: 'gcContingencyAmount',
  },
];

export const contingencyMisuse: RuleFn = (profile, payApp) => {
  const findings: Finding[] = [];
  if (!profile.contingencyRequiresAuthorization) return findings;

  for (const { category, label, ownerLabel, amountField } of BUCKETS) {
    const draws = payApp.lineItems.filter(
      (l) => l.category === category && l.workCompletedThisPeriod > 0,
    );
    if (draws.length === 0) continue;

    const exposure = roundCents(
      draws.reduce((acc, l) => acc + l.workCompletedThisPeriod, 0),
    );

    findings.push({
      ruleId: 'CONTINGENCY_MISUSE',
      severity: 'medium',
      title: `${ownerLabel} contingency drawn this period`,
      affectedLineItems: draws.map((l) => l.code),
      dollarExposure: exposure,
      contractBasis: `contingencyRequiresAuthorization = true; ${amountField} = ${
        profile[amountField] ?? 'unset'
      }`,
      explanation:
        `${draws.length} ${label} line(s) show draws totaling ${exposure} this period. ` +
        `The Project Profile requires written authorization for contingency draws. ` +
        `Confirm a signed authorization exists for each draw.`,
      recommendedAction:
        `Obtain the written authorization (PCO, construction change directive, or owner approval letter) ` +
        `for each draw. If none exists, request reversal of the draw or formalize the authorization ` +
        `before certifying payment.`,
      reviewFlagOnly: true,
    });
  }

  return findings;
};
