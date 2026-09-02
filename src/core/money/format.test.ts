import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { currencySymbol, minorUnitExponent } from './currency';
import { formatAmountOnly, formatMoney, formatMoneyParts } from './format';
import { minor, toDecimalString } from './minor';

const eur = { currency: 'EUR', locale: 'en-GB' } as const;
const usd = { currency: 'USD', locale: 'en-US' } as const;

describe('minor-unit exponents come from ICU, not a table', () => {
  it('resolves the right precision per currency', () => {
    expect(minorUnitExponent('EUR')).toBe(2);
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('BHD')).toBe(3);
  });

  it('rejects a code ICU does not know', () => {
    expect(() => minorUnitExponent('XYZ')).toThrow();
  });
});

describe('formatMoney', () => {
  it('formats the base currency with its own symbol and separators', () => {
    expect(formatMoney(minor(123_450), eur)).toBe('€1,234.50');
    expect(formatMoney(minor(123_450), usd)).toBe('$1,234.50');
  });

  it('follows the locale, not the currency, for grouping and placement', () => {
    // Same amount, same currency, three locales: symbol position and
    // separators all differ. No component could get this right by hand.
    const amount = minor(123_450);
    expect(formatMoney(amount, { currency: 'EUR', locale: 'de-DE' })).toMatch(/1\.234,50/);
    expect(formatMoney(amount, { currency: 'EUR', locale: 'en-GB' })).toMatch(/1,234\.50/);
    expect(formatMoney(amount, { currency: 'EUR', locale: 'fr-FR' })).toMatch(/1.234,50/);
  });

  it('respects zero-decimal and three-decimal currencies', () => {
    expect(formatMoney(minor(1234), { currency: 'JPY', locale: 'en-GB' })).toBe('¥1,234');
    expect(formatMoney(minor(1234), { currency: 'BHD', locale: 'en-GB' })).toMatch(/1\.234/);
  });

  it('uses a true minus sign so columns stay aligned', () => {
    const text = formatMoney(minor(-4200), eur);
    expect(text).toContain('−');
    expect(text).not.toContain('-');
  });

  it('supports explicit sign display for deltas', () => {
    expect(formatMoney(minor(4200), { ...eur, signDisplay: 'always' })).toContain('+');
    expect(formatMoney(minor(-4200), { ...eur, signDisplay: 'never' })).not.toContain('−');
  });

  it('hides decimals on request, and adaptively on large figures', () => {
    expect(formatMoney(minor(123_450), { ...eur, decimals: 'hide' })).toBe('€1,235');
    expect(formatMoney(minor(950_00), { ...eur, decimals: 'adaptive' })).toBe('€950.00');
    expect(formatMoney(minor(1_500_000_00), { ...eur, decimals: 'adaptive' })).toBe('€1,500,000');
  });

  it('abbreviates for axis labels', () => {
    // ICU chooses the abbreviation's case and precision per locale.
    expect(formatMoney(minor(1_200_000_00), { ...eur, compact: true })).toMatch(/1\.2\s?m/i);
    expect(formatMoney(minor(1_200_000_00), { ...usd, compact: true })).toMatch(/1\.2\s?m/i);
  });

  it('drops the symbol for input fields', () => {
    const bare = formatAmountOnly(minor(123_450), eur);
    expect(bare).toBe('1,234.50');
    expect(bare).not.toContain(currencySymbol('EUR', 'en-GB'));
  });
});

describe('exactness', () => {
  it('passes an exact decimal string to Intl — no float division', () => {
    // 0.1 + 0.2 style drift would show here as a trailing 9 or a lost cent.
    for (const cents of [1, 5, 7, 29, 115, 12_345, 99_999_999]) {
      const expected = toDecimalString(minor(cents), 2);
      const formatted = formatAmountOnly(minor(cents), { ...eur, locale: 'en-US' });
      expect(formatted.replace(/,/g, '')).toBe(expected);
    }
  });

  it('stays exact at the top of the safe-integer range', () => {
    // ~90 trillion. `amount / 100` would already have lost precision here.
    const amount = minor(9_007_199_254_740_9);
    const expected = toDecimalString(amount, 2);
    expect(formatAmountOnly(amount, { ...eur, locale: 'en-US' }).replace(/,/g, '')).toBe(expected);
  });

  it('never produces NaN, which is what a failed string coercion looks like', () => {
    expect(formatMoney(minor(123_456_789), eur)).not.toContain('NaN');
  });
});

describe('formatMoneyParts', () => {
  it('decomposes without the caller assembling a symbol', () => {
    const parts = formatMoneyParts(minor(-123_450), eur);
    expect(parts.sign).toBe('−');
    expect(parts.symbol).toBe(currencySymbol('EUR', 'en-GB'));
    expect(parts.integer).toBe('1,234');
    expect(parts.decimalSeparator).toBe('.');
    expect(parts.fraction).toBe('50');
    expect(parts.isNegative).toBe(true);
  });

  it('reports symbol placement so layout can follow the locale', () => {
    expect(formatMoneyParts(minor(1000), { currency: 'EUR', locale: 'en-GB' }).symbolTrails)
      .toBe(false);
    expect(formatMoneyParts(minor(1000), { currency: 'EUR', locale: 'de-DE' }).symbolTrails)
      .toBe(true);
  });

  it('reassembles to exactly what formatMoney returns', () => {
    const rebuild = (p: ReturnType<typeof formatMoneyParts>) => {
      const number = `${p.integer}${p.decimalSeparator}${p.fraction}${p.suffixGap}${p.suffix}`;
      return p.symbolTrails
        ? `${p.sign}${number}${p.gap}${p.symbol}`
        : `${p.sign}${p.symbol}${p.gap}${number}`;
    };

    for (const locale of ['en-GB', 'de-DE', 'fr-FR']) {
      for (const amount of [0, 5, -5, 123_450, -9_999_999]) {
        const p = formatMoneyParts(minor(amount), { currency: 'EUR', locale });
        expect(rebuild(p)).toBe(p.full);
      }
      // Compact is the case where a naive decomposition produces '1M.3'.
      for (const amount of [1_200_000_00, 45_600_00, -2_300_000_00]) {
        const p = formatMoneyParts(minor(amount), { currency: 'EUR', locale, compact: true });
        expect(rebuild(p)).toBe(p.full);
      }
    }
  });
});

describe('changing the base currency is a config change', () => {
  it('renders the same ledger amount in any currency without touching a call site', () => {
    const amount = minor(123_450);
    const rendered = (['EUR', 'USD', 'GBP', 'CHF', 'SEK'] as const).map((currency) =>
      formatMoney(amount, { currency, locale: 'en-GB' }),
    );
    // Five distinct outputs, none of which required a code path of its own.
    expect(new Set(rendered).size).toBe(5);
  });
});

/* ===========================================================================
 * THE ABSTRACTION GUARD
 * ---------------------------------------------------------------------------
 * Requirement 3 is "never hardcode currency symbols in a UI component". A
 * convention that lives only in a code review is a convention that decays, so
 * it is enforced here: this test walks the source tree and fails the build if
 * any file outside the money module writes a currency symbol, or reaches for
 * Intl.NumberFormat directly instead of going through the formatter.
 * ======================================================================== */

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXEMPT = ['core/money', 'node_modules', 'dist'];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = full.slice(SRC_ROOT.length).replace(/\\/g, '/');
    if (EXEMPT.some((e) => rel.startsWith(e))) continue;
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/** Remove comments so prose about money does not trip the check. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

describe('no hardcoded currency in the app', () => {
  const files = sourceFiles(SRC_ROOT);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * Any non-dollar currency sign anywhere, or a dollar sign attached to
   * something shaped like a price (two or more digits, or a decimal mark).
   *
   * The dollar rule has to be this specific because `${...}` is template
   * syntax and `$1` is a regex back-reference. A guard that flags ordinary
   * JavaScript gets switched off within a week, and then it guards nothing.
   */
  const CURRENCY_LITERAL = /[€£¥₹₽₩₿]|\$\s?\d[\d.,]|[\d.,]\d\s?\$/;

  it('has no currency symbol outside the money module', () => {
    const offenders = files
      .map((f) => ({ file: f.slice(SRC_ROOT.length), code: stripComments(readFileSync(f, 'utf8')) }))
      .filter(({ code }) => CURRENCY_LITERAL.test(code))
      .map(({ file, code }) => `${file}: ${code.match(CURRENCY_LITERAL)?.[0]}`);

    expect(offenders, 'Use formatMoney or <Money> instead of a literal symbol').toEqual([]);
  });

  it('actually catches a hardcoded symbol when one is introduced', () => {
    // A guard nobody has seen fail is a guard nobody trusts.
    expect(CURRENCY_LITERAL.test('const label = "Total: €42.00";')).toBe(true);
    expect(CURRENCY_LITERAL.test('<span>$1,240.00</span>')).toBe(true);
    expect(CURRENCY_LITERAL.test('const total = "1.240,00 €";')).toBe(true);
    // ...and does not fire on the JavaScript that merely looks like one.
    expect(CURRENCY_LITERAL.test('const msg = `Balance ${amount}`;')).toBe(false);
    expect(CURRENCY_LITERAL.test("text.replace(/^a/, '$1')")).toBe(false);
    expect(CURRENCY_LITERAL.test('const price = formatMoney(minor(4235), opts);')).toBe(false);
  });

  it('has no direct Intl.NumberFormat use outside the money module', () => {
    const offenders = files
      .filter((f) => /Intl\.NumberFormat/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(SRC_ROOT.length));

    expect(offenders, 'Route currency formatting through @/core/money').toEqual([]);
  });
});
