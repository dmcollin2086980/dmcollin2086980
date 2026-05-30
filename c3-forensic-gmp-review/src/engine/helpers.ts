import type { LineCategory, PayAppLineItem } from './types';

export const EPSILON = 0.01;

export const completedToDate = (line: PayAppLineItem): number =>
  line.workCompletedPrevious + line.workCompletedThisPeriod;

export const linesByCategory = (
  lines: PayAppLineItem[],
  category: LineCategory,
): PayAppLineItem[] => lines.filter((l) => l.category === category);

export const sumCompletedToDate = (lines: PayAppLineItem[]): number =>
  lines.reduce((acc, l) => acc + completedToDate(l), 0);

export const roundCents = (n: number): number => Math.round(n * 100) / 100;

export const approximatelyEqual = (
  a: number,
  b: number,
  eps: number = EPSILON,
): boolean => Math.abs(a - b) <= eps;
