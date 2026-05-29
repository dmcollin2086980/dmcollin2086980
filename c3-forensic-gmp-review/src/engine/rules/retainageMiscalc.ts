import type { Finding, RuleFn } from '../types';
import { approximatelyEqual, completedToDate, roundCents } from '../helpers';

export const retainageMiscalc: RuleFn = (profile, payApp) => {
  const findings: Finding[] = [];
  const releasedSet = new Set(profile.retainageReleasedLineItems ?? []);

  let completedBase = 0;
  let storedBase = 0;
  let totalCompletedAndStoredAll = 0;
  for (const line of payApp.lineItems) {
    const c = completedToDate(line);
    const s = line.materialsPresentlyStored;
    totalCompletedAndStoredAll += c + s;
    if (releasedSet.has(line.code)) continue;
    completedBase += c;
    storedBase += s;
  }

  const includeStored = profile.retainageOnStoredMaterials;
  const baseAmount = completedBase + (includeStored ? storedBase : 0);

  let effectiveRate = profile.retainagePercent;
  let reductionTriggered = false;
  if (
    profile.retainageReductionAtPercent !== undefined &&
    profile.gmpAmount > 0
  ) {
    const completionPercent = totalCompletedAndStoredAll / profile.gmpAmount;
    if (completionPercent >= profile.retainageReductionAtPercent) {
      effectiveRate = 0;
      reductionTriggered = true;
    }
  }

  const expectedRetainage = roundCents(effectiveRate * baseAmount);
  const reported = payApp.reportedRetainage;
  if (approximatelyEqual(reported, expectedRetainage)) return findings;

  const delta = roundCents(reported - expectedRetainage);
  const overWithheld = delta > 0;

  const contractBasisParts = [
    `retainagePercent = ${profile.retainagePercent}`,
    `retainageOnStoredMaterials = ${profile.retainageOnStoredMaterials}`,
  ];
  if (profile.retainageReductionAtPercent !== undefined) {
    contractBasisParts.push(
      `retainageReductionAtPercent = ${profile.retainageReductionAtPercent}`,
    );
  }
  if ((profile.retainageReleasedLineItems ?? []).length > 0) {
    contractBasisParts.push(
      `retainageReleasedLineItems = [${(profile.retainageReleasedLineItems ?? []).join(', ')}]`,
    );
  }

  findings.push({
    ruleId: 'RETAINAGE_MISCALC',
    severity: 'high',
    title: overWithheld
      ? 'Retainage over-withheld by contractor'
      : 'Retainage under-withheld by contractor',
    affectedLineItems: [],
    dollarExposure: Math.abs(delta),
    contractBasis: contractBasisParts.join('; '),
    explanation:
      `Expected retainage = ${effectiveRate} x ${roundCents(baseAmount)} = ${expectedRetainage}. ` +
      `Reported retainage = ${reported}. Delta = ${delta} ` +
      (overWithheld
        ? `(owner cash improperly held).`
        : `(owner exposure on under-withheld retainage).`) +
      (reductionTriggered
        ? ` Retainage reduction threshold reached; effective rate stepped to 0.`
        : ''),
    recommendedAction: overWithheld
      ? `Request release of the over-withheld amount on the next pay application.`
      : `Confirm whether reduced retainage was authorized in writing; if not, withhold the additional amount.`,
    reviewFlagOnly: true,
  });

  return findings;
};
