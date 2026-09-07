/* ===========================================================================
 * THE TAX ALREADY INSIDE YOUR NET WORTH
 * ---------------------------------------------------------------------------
 * A portfolio worth ninety thousand that cost sixty is not ninety thousand of
 * yours. Somewhere in that thirty of growth sits a bill that arrives the day
 * you sell, and every net-worth figure in every money app quietly ignores it.
 *
 * This works out what that bill would be, so the number can be shown next to
 * the one that ignores it. Nothing here is stored, nothing is filed, and no
 * posting is ever written from it — a deferred tax liability is a fact about a
 * sale that has not happened, and recording it would be recording an event
 * that did not occur.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 *
 * It is not tax advice, it is not a return, and it does not know your
 * circumstances. It applies a rate you gave it to a gain the ledger already
 * knows about. Reliefs, losses carried forward, allowances shared with a
 * spouse, the treatment of a particular fund — none of that is here, and the
 * copy says so rather than implying a completeness this cannot have.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO REGIMES THAT WORK NOTHING ALIKE
 *
 * Most places tax the gain when you take it. Some — the Netherlands being the
 * one this household lives under — do not tax gains at all, and instead charge
 * an annual amount on a *deemed* return on what you hold, whether or not it
 * went up, and whether or not you sold anything.
 *
 * Papering over that difference would produce a figure that is wrong in both
 * places. Under a deemed-return regime the honest answer to "how much tax is
 * waiting inside this gain?" is *none* — there is no latent liability, there
 * is a bill every year regardless. So the two are modelled separately and the
 * result says which question it answered.
 *
 * Rates are inputs, never constants. They change every year, this application
 * never goes online, and a rate baked in today would be quietly wrong by
 * January. `DUTCH_BOX3_2025` and friends are starting points that carry the
 * year they came from, and the interface shows that year.
 * ======================================================================== */

import { ZERO, basisPoints, minor, mulDivRound, type BasisPoints, type Minor } from '@/core/money';

/* ===========================================================================
 * A GAIN TAXED WHEN IT IS TAKEN
 * ======================================================================== */

export interface FlatGainsRegime {
  kind: 'flat_gains';
  /** What it is called where the person lives: "Capital Gains Tax". */
  name: string;
  /** The rate applied to a taxable gain, in basis points. 3,300 is 33%. */
  rateBp: BasisPoints;
  /**
   * Gain that is not taxed at all each year.
   *
   * Modelled as a yearly allowance rather than a lifetime one, because that
   * is what every flat regime this is meant for actually does.
   */
  annualExemption: Minor;
  /** The year the rate and exemption were true for. Shown, never assumed. */
  year: number;
}

/* ===========================================================================
 * A DEEMED RETURN, TAXED EVERY YEAR
 * ---------------------------------------------------------------------------
 * The Dutch shape. Three buckets with different assumed returns, a tax-free
 * amount, and a rate applied to the assumed income rather than to any money
 * that actually arrived.
 * ======================================================================== */

export interface DeemedReturnRegime {
  kind: 'deemed_return';
  name: string;
  /** Assumed return on money in bank accounts, in basis points. */
  savingsReturnBp: BasisPoints;
  /** Assumed return on everything else you hold. */
  investmentReturnBp: BasisPoints;
  /** The rate debts are assumed to cost you, deducted from the return. */
  debtReturnBp: BasisPoints;
  /** Net assets below this are not taxed at all. */
  taxFreeAmount: Minor;
  /** Debt below this is ignored entirely rather than deducted. */
  debtThreshold: Minor;
  /** Applied to the deemed income, not to anything received. */
  rateBp: BasisPoints;
  year: number;
}

export type TaxRegime = FlatGainsRegime | DeemedReturnRegime;

/**
 * Starting points, each stamped with the year it was true for.
 *
 * Deliberately not called "current". Nothing in this application can know
 * what year it is being used in relative to a rate change, and a constant
 * named `CURRENT_RATE` is a lie waiting for January.
 */
export const DUTCH_BOX3_2025: DeemedReturnRegime = {
  kind: 'deemed_return',
  name: 'Box 3',
  savingsReturnBp: basisPoints(144),
  investmentReturnBp: basisPoints(588),
  debtReturnBp: basisPoints(262),
  // €57,684 and €3,800. Written in minor units, grouped in thousands, because
  // a digit separator in the wrong place turns fifty-seven thousand into five
  // and a half — which is exactly what it did the first time this was written.
  taxFreeAmount: minor(5_768_400),
  debtThreshold: minor(380_000),
  rateBp: basisPoints(3_600),
  year: 2025,
};

export const IRISH_CGT_2025: FlatGainsRegime = {
  kind: 'flat_gains',
  name: 'Capital Gains Tax',
  rateBp: basisPoints(3_300),
  // €1,270 in minor units.
  annualExemption: minor(127_000),
  year: 2025,
};

/* ===========================================================================
 * WHAT YOU HOLD
 * ======================================================================== */

export interface TaxableEstate {
  /** Money in bank accounts, on the day this is being worked out. */
  savings: Minor;
  /** Everything else held: funds, shares, a second property. */
  investments: Minor;
  /** What those investments cost. Only a gains regime reads this. */
  investmentCostBasis: Minor;
  /** What is owed. Only a deemed-return regime reads this. */
  debts: Minor;
}

export interface DeferredTax {
  /** What would be owed, worked out under the regime given. */
  amount: Minor;
  /**
   * Whether this is a bill waiting inside a gain, or one that arrives yearly.
   *
   * The distinction is the whole reason both regimes are here, and every
   * sentence about the figure has to know which it is.
   */
  timing: 'on_sale' | 'every_year';
  /** The gain the tax was worked out on, after any exemption. */
  taxableAmount: Minor;
  /** The gain before the exemption, or the deemed income before the tax-free sum. */
  grossAmount: Minor;
  /** What the exemption or tax-free amount actually took off. */
  reliefApplied: Minor;
  regime: TaxRegime;
}

/**
 * What tax is sitting inside what this household holds.
 *
 * Under a gains regime that is a liability waiting for a sale. Under a
 * deemed-return regime there is no such liability, and what comes back is the
 * annual charge instead — with `timing` saying so, because a figure labelled
 * the same in both places would be read the same in both places and be wrong
 * in one of them.
 */
export function deferredTax(estate: TaxableEstate, regime: TaxRegime): DeferredTax {
  return regime.kind === 'flat_gains'
    ? onUnrealisedGain(estate, regime)
    : onDeemedReturn(estate, regime);
}

function onUnrealisedGain(estate: TaxableEstate, regime: FlatGainsRegime): DeferredTax {
  // A loss is not a negative tax bill. It may be worth something against a
  // future gain, but that depends on rules this module does not model, and
  // showing a negative liability would read as money owed to the person.
  const gain = minor(Math.max(0, estate.investments - estate.investmentCostBasis));
  const relief = minor(Math.min(gain, Math.max(0, regime.annualExemption)));
  const taxable = minor(gain - relief);

  return {
    amount: mulDivRound(taxable, regime.rateBp, 10_000),
    timing: 'on_sale',
    taxableAmount: taxable,
    grossAmount: gain,
    reliefApplied: relief,
    regime,
  };
}

/**
 * The deemed-return sum, in the order the law does it.
 *
 * The awkward step is the last one. The deemed return is worked out on
 * everything you hold, but the *tax* is charged only on the part above the
 * tax-free amount — so the effective return rate is applied to the smaller
 * base rather than the return itself being reduced. Doing it the other way
 * round overstates the relief for anybody whose money is mostly in a bank
 * account and understates it for anybody whose money is mostly invested.
 */
function onDeemedReturn(estate: TaxableEstate, regime: DeemedReturnRegime): DeferredTax {
  const savings = minor(Math.max(0, estate.savings));
  const investments = minor(Math.max(0, estate.investments));
  // Small debts are ignored rather than deducted. Everybody has a current
  // account overdraft at some point and the law does not care about it.
  const debts = minor(Math.max(0, estate.debts - Math.max(0, regime.debtThreshold)));

  const assets = minor(savings + investments);
  const netAssets = minor(assets - debts);

  const deemedReturn = minor(
    mulDivRound(savings, regime.savingsReturnBp, 10_000) +
      mulDivRound(investments, regime.investmentReturnBp, 10_000) -
      mulDivRound(debts, regime.debtReturnBp, 10_000),
  );

  const taxableBase = minor(Math.max(0, netAssets - Math.max(0, regime.taxFreeAmount)));

  // Nothing to tax, and nothing to divide by either.
  if (netAssets <= 0 || taxableBase === 0 || deemedReturn <= 0) {
    return {
      amount: ZERO,
      timing: 'every_year',
      taxableAmount: ZERO,
      grossAmount: minor(Math.max(0, deemedReturn)),
      reliefApplied: minor(Math.min(netAssets > 0 ? netAssets : 0, regime.taxFreeAmount)),
      regime,
    };
  }

  // The share of the deemed return that falls above the tax-free amount.
  const deemedIncome = mulDivRound(deemedReturn, taxableBase, netAssets);

  return {
    amount: mulDivRound(deemedIncome, regime.rateBp, 10_000),
    timing: 'every_year',
    taxableAmount: deemedIncome,
    grossAmount: deemedReturn,
    reliefApplied: minor(deemedReturn - deemedIncome),
    regime,
  };
}

/* ===========================================================================
 * SAYING IT
 * ======================================================================== */

/**
 * What the figure means, in a sentence.
 *
 * Takes the formatter so this module stays free of currency and locale, and
 * says which year the rate came from every time — a tax figure without a year
 * on it is a figure somebody will still be trusting in three years.
 */
export function describeDeferredTax(
  result: DeferredTax,
  format: (amount: Minor) => string,
): string {
  if (result.timing === 'every_year') {
    return result.amount === 0
      ? `Under ${result.regime.name}, what you hold is below the tax-free amount, so there is ` +
          `nothing to pay this year. Worked out on ${result.regime.year} rates.`
      : `Under ${result.regime.name} you would be charged about ${format(result.amount)} a year ` +
          `on what you hold, whether or not it goes up and whether or not you sell. Worked out ` +
          `on ${result.regime.year} rates.`;
  }

  if (result.grossAmount === 0) {
    return (
      `There is no gain on what you hold at the moment, so no ${result.regime.name.toLowerCase()} ` +
      `is waiting inside it.`
    );
  }

  if (result.amount === 0) {
    return (
      `Your gain of ${format(result.grossAmount)} is inside the ${result.regime.year} ` +
      `allowance, so selling it all today would leave nothing to pay.`
    );
  }

  return (
    `About ${format(result.amount)} of what you are worth is ${result.regime.name.toLowerCase()} ` +
    `waiting to be paid. It falls due if you sell, not before. Worked out on ${result.regime.year} ` +
    `rates and does not know your circumstances.`
  );
}

/**
 * Net worth with the deferred bill taken off.
 *
 * Only meaningful under a gains regime: an annual charge is a cost of holding
 * rather than something owed out of the figure, and subtracting it once would
 * be neither this year's bill nor a liability.
 */
export function netWorthAfterTax(netWorth: Minor, result: DeferredTax): Minor | null {
  if (result.timing !== 'on_sale') return null;
  return minor(netWorth - result.amount);
}

/**
 * The whole thing as a rate, for a one-line summary.
 *
 * Basis points of the gain that would go in tax. Returns null when there is no
 * gain to take a proportion of — nought per cent of nothing invites the reader
 * to conclude something reassuring about a figure that does not exist.
 */
export function effectiveRateBp(result: DeferredTax): BasisPoints | null {
  if (result.grossAmount <= 0) return null;
  return basisPoints(mulDivRound(result.amount, 10_000, result.grossAmount));
}
