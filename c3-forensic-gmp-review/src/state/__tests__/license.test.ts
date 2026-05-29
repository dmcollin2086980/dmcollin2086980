// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLicenseKey,
  isValidLicenseKey,
  loadLicenseKey,
  maskDollars,
  saveLicenseKey,
} from '../license';

afterEach(() => {
  window.localStorage.clear();
});

describe('isValidLicenseKey', () => {
  it('accepts the documented format', () => {
    expect(isValidLicenseKey('C3-DEMO-V100')).toBe(true);
    expect(isValidLicenseKey('C3-PROD-9F2K')).toBe(true);
    expect(isValidLicenseKey('  C3-DEMO-V100  ')).toBe(true);
  });

  it('rejects empty, lowercase-only, or unrelated strings', () => {
    expect(isValidLicenseKey('')).toBe(false);
    expect(isValidLicenseKey('not-a-key')).toBe(false);
    expect(isValidLicenseKey('demo')).toBe(false);
    expect(isValidLicenseKey('C3-')).toBe(false);
    expect(isValidLicenseKey('C3-ABC-DEF')).toBe(false); // segments too short
  });
});

describe('localStorage helpers', () => {
  it('round-trips a valid key via save / load / clear', () => {
    expect(loadLicenseKey()).toBeNull();
    saveLicenseKey('C3-DEMO-V100');
    expect(loadLicenseKey()).toBe('C3-DEMO-V100');
    clearLicenseKey();
    expect(loadLicenseKey()).toBeNull();
  });

  it('trims surrounding whitespace before storing', () => {
    saveLicenseKey('   C3-DEMO-V100   ');
    expect(window.localStorage.getItem('c3-license-key')).toBe('C3-DEMO-V100');
  });

  it('returns null when stored value fails the format check', () => {
    window.localStorage.setItem('c3-license-key', 'tampered-value');
    expect(loadLicenseKey()).toBeNull();
  });
});

describe('maskDollars', () => {
  it('replaces formatted USD amounts with the placeholder', () => {
    expect(maskDollars('Exposure: $26,150.00')).toBe('Exposure: $•••');
    expect(maskDollars('$5,000,000 / $1,200.50')).toBe('$••• / $•••');
    expect(maskDollars('$0.00')).toBe('$•••');
  });

  it('leaves non-USD text alone', () => {
    expect(maskDollars('No dollars here.')).toBe('No dollars here.');
    expect(maskDollars('Reference 26,150 percent.')).toBe('Reference 26,150 percent.');
  });
});
