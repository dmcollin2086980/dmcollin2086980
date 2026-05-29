import type { Finding, RuleFn } from '../types';
import { approximatelyEqual, completedToDate, roundCents } from '../helpers';

export const arithmeticIntegrity: RuleFn = (_profile, payApp) => {
  const findings: Finding[] = [];

  const computedTotalCompletedAndStored = roundCents(
    payApp.lineItems.reduce(
      (acc, l) => acc + completedToDate(l) + l.materialsPresentlyStored,
      0,
    ),
  );

  if (
    !approximatelyEqual(
      computedTotalCompletedAndStored,
      payApp.reportedTotalCompletedAndStored,
    )
  ) {
    const delta = roundCents(
      payApp.reportedTotalCompletedAndStored - computedTotalCompletedAndStored,
    );
    findings.push({
      ruleId: 'ARITHMETIC_INTEGRITY',
      severity: 'high',
      title: 'G702 total completed and stored does not tie to G703 line sum',
      affectedLineItems: [],
      dollarExposure: Math.abs(delta),
      contractBasis: 'AIA G702/G703 arithmetic integrity',
      explanation:
        `Reported total completed and stored = ${payApp.reportedTotalCompletedAndStored}. ` +
        `Sum of G703 lines (previous + this period + stored) = ${computedTotalCompletedAndStored}. ` +
        `Delta = ${delta}.`,
      recommendedAction:
        `Request a corrected pay application. Do not certify payment until G702 totals tie to G703 line items.`,
      reviewFlagOnly: true,
    });
  }

  const expectedEarnedLessRetainage = roundCents(
    payApp.reportedTotalCompletedAndStored - payApp.reportedRetainage,
  );
  if (
    !approximatelyEqual(
      expectedEarnedLessRetainage,
      payApp.reportedTotalEarnedLessRetainage,
    )
  ) {
    const delta = roundCents(
      payApp.reportedTotalEarnedLessRetainage - expectedEarnedLessRetainage,
    );
    findings.push({
      ruleId: 'ARITHMETIC_INTEGRITY',
      severity: 'high',
      title: 'G702 total earned less retainage is internally inconsistent',
      affectedLineItems: [],
      dollarExposure: Math.abs(delta),
      contractBasis: 'AIA G702 arithmetic integrity',
      explanation:
        `Expected = reportedTotalCompletedAndStored - reportedRetainage = ${expectedEarnedLessRetainage}. ` +
        `Reported = ${payApp.reportedTotalEarnedLessRetainage}. Delta = ${delta}.`,
      recommendedAction: `Request a corrected pay application.`,
      reviewFlagOnly: true,
    });
  }

  const expectedCurrentDue = roundCents(
    payApp.reportedTotalEarnedLessRetainage -
      payApp.reportedLessPreviousCertificates,
  );
  if (
    !approximatelyEqual(expectedCurrentDue, payApp.reportedCurrentPaymentDue)
  ) {
    const delta = roundCents(
      payApp.reportedCurrentPaymentDue - expectedCurrentDue,
    );
    findings.push({
      ruleId: 'ARITHMETIC_INTEGRITY',
      severity: 'high',
      title: 'G702 current payment due is internally inconsistent',
      affectedLineItems: [],
      dollarExposure: Math.abs(delta),
      contractBasis: 'AIA G702 arithmetic integrity',
      explanation:
        `Expected = reportedTotalEarnedLessRetainage - reportedLessPreviousCertificates = ${expectedCurrentDue}. ` +
        `Reported = ${payApp.reportedCurrentPaymentDue}. Delta = ${delta}.`,
      recommendedAction: `Request a corrected pay application.`,
      reviewFlagOnly: true,
    });
  }

  return findings;
};
