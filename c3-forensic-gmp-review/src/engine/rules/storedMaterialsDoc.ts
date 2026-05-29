import type { Finding, RuleFn } from '../types';
import { roundCents } from '../helpers';

export const storedMaterialsDoc: RuleFn = (_profile, payApp) => {
  const findings: Finding[] = [];
  const linesWithStored = payApp.lineItems.filter(
    (l) => l.materialsPresentlyStored > 0,
  );
  if (linesWithStored.length === 0) return findings;

  const totalStored = roundCents(
    linesWithStored.reduce((acc, l) => acc + l.materialsPresentlyStored, 0),
  );

  findings.push({
    ruleId: 'STORED_MATERIALS_DOC',
    severity: 'low',
    title: 'Stored materials require documentation',
    affectedLineItems: linesWithStored.map((l) => l.code),
    dollarExposure: totalStored,
    contractBasis:
      'AIA G703 stored materials column; standard owner documentation requirements',
    explanation:
      `${linesWithStored.length} line item(s) show materials presently stored totaling ${totalStored}. ` +
      `This is informational, not an over-billing claim, but the owner should confirm documentation is on file.`,
    recommendedAction:
      `For each stored-materials line, confirm: vendor invoice or bill of sale, transfer of title to ` +
      `the owner, insurance covering the stored materials, and (if off-site) an executed off-site storage agreement.`,
    reviewFlagOnly: true,
  });

  return findings;
};
