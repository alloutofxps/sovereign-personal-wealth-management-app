/* ===========================================================================
 * WHICH SHARES DID YOU SELL?
 * ---------------------------------------------------------------------------
 * The question sounds pedantic and decides the tax bill. Somebody who bought
 * 20 shares in January at €100 and 30 in June at €120, then sells 20, has
 * either made €500 or lost €100 depending entirely on which twenty went. The
 * shares themselves are identical and interchangeable; the parcels are not.
 *
 * Averaging the whole holding — which is what the register's cost basis does
 * on its own — is permitted in some jurisdictions and wrong in others, and it
 * silently produces a third answer again. So parcels are tracked, and the
 * oldest go first: the assumption most tax authorities make by default, and
 * the only one that can be applied without asking somebody to nominate lots by
 * hand for every sale they ever make.
 *
 * Everything here is integer arithmetic. A cost basis prorated with floating
 * point is a cost basis that does not add back up to what was paid, and the
 * error surfaces years later as a gain figure nobody can reconcile.
 * ======================================================================== */

import { minor, mulDivRound, type Minor } from '@/core/money';
import { QUANTITY_SCALE, formatQuantity } from './holdingsMath';

export interface TaxLot {
  id: string;
  accountId: string;
  securityId: string;
  holdingId: string;
  /** 'YYYY-MM-DD'. When this parcel was acquired. */
  acquiredDate: string;
  /** What the parcel was when it was bought. Never changes. */
  quantity1e8: number;
  /** What is left of it, as parts of it are sold off. */
  remainingQuantity1e8: number;
  /** What the whole original parcel cost, in minor units. */
  costBasisMinor: Minor;
  isClosed: boolean;
}

export interface LotRelief {
  lotId: string;
  acquiredDate: string;
  /** How much of this parcel went. */
  quantity1e8: number;
  /** That share of what the parcel cost. */
  costBasisMinor: Minor;
  /** What that part of the sale brought in, before fees. */
  proceedsMinor: Minor;
  /** Whether the parcel is now completely gone. */
  closes: boolean;
}

export interface DisposalResult {
  /** Every lot, with the sold ones depleted. Unchanged lots come back as-is. */
  updatedLots: TaxLot[];
  /** Which parcels were used, oldest first. What the preview reads from. */
  relieved: LotRelief[];
  /** What actually arrives, after fees. */
  totalProceeds: Minor;
  /** What the shares that went originally cost. */
  totalCostBasisRelieved: Minor;
  /** Proceeds less cost. Negative on a loss. */
  realizedGain: Minor;
  feesMinor: Minor;
}

export class DisposalError extends Error {
  override name = 'DisposalError';
}

/** Every open parcel, oldest first — the order they are sold in. */
export function openLotsInOrder(lots: readonly TaxLot[]): TaxLot[] {
  return lots
    .filter((lot) => !lot.isClosed && lot.remainingQuantity1e8 > 0)
    .sort(
      (a, b) =>
        a.acquiredDate.localeCompare(b.acquiredDate) ||
        // Two parcels bought the same day still need a settled order, or the
        // same sale would relieve them differently on different devices.
        a.id.localeCompare(b.id),
    );
}

/** How many shares are held across all open parcels. */
export function totalRemaining(lots: readonly TaxLot[]): number {
  return openLotsInOrder(lots).reduce((sum, lot) => sum + lot.remainingQuantity1e8, 0);
}

/**
 * Work out which parcels a sale takes, and what it realises.
 *
 * Pure: it returns what the lots *would* become and never touches storage.
 * The repository writes the result inside the same transaction as the journal
 * entry, so a sale can never half-happen.
 */
export function relieveLotsFIFO(input: {
  lots: readonly TaxLot[];
  sellQuantity1e8: number;
  salePriceMinor: Minor;
  feesMinor?: Minor;
}): DisposalResult {
  const fees = minor(input.feesMinor ?? 0);
  const sell = input.sellQuantity1e8;

  if (sell <= 0) {
    throw new DisposalError('Enter how many shares you want to sell.');
  }
  if (!Number.isSafeInteger(sell)) {
    throw new DisposalError('That is more shares than this can count exactly.');
  }
  if (fees < 0) {
    throw new DisposalError('A fee cannot be a negative amount.');
  }

  const open = openLotsInOrder(input.lots);
  const available = open.reduce((sum, lot) => sum + lot.remainingQuantity1e8, 0);

  if (sell > available) {
    throw new DisposalError(
      `You cannot sell more shares than you hold. There are ` +
        `${formatQuantity(available)} to sell.`,
    );
  }

  const relieved: LotRelief[] = [];
  const depleted = new Map<string, { remaining: number; closed: boolean }>();

  let outstanding = sell;
  let totalCost = 0;

  for (const lot of open) {
    if (outstanding <= 0) break;

    const taken = Math.min(outstanding, lot.remainingQuantity1e8);

    // The parcel's cost is prorated against its *original* size, not against
    // what is left of it. Prorating against the remainder would re-average the
    // cost every time part of a parcel was sold, and the parts would stop
    // adding back up to what was paid for the whole.
    const costTaken = mulDivRound(lot.costBasisMinor, taken, lot.quantity1e8);
    const proceedsTaken = mulDivRound(input.salePriceMinor, taken, QUANTITY_SCALE);

    const remaining = lot.remainingQuantity1e8 - taken;
    depleted.set(lot.id, { remaining, closed: remaining === 0 });

    relieved.push({
      lotId: lot.id,
      acquiredDate: lot.acquiredDate,
      quantity1e8: taken,
      costBasisMinor: costTaken,
      proceedsMinor: proceedsTaken,
      closes: remaining === 0,
    });

    totalCost += costTaken;
    outstanding -= taken;
  }

  // The whole sale is valued once rather than summed from the parcels, so the
  // total is the figure the person was quoted rather than the sum of several
  // separate roundings.
  const gross = mulDivRound(input.salePriceMinor, sell, QUANTITY_SCALE);
  const totalProceeds = minor(gross - fees);
  const totalCostBasisRelieved = minor(totalCost);

  return {
    updatedLots: input.lots.map((lot) => {
      const change = depleted.get(lot.id);
      if (!change) return lot;
      return { ...lot, remainingQuantity1e8: change.remaining, isClosed: change.closed };
    }),
    relieved,
    totalProceeds,
    totalCostBasisRelieved,
    realizedGain: minor(totalProceeds - totalCostBasisRelieved),
    feesMinor: fees,
  };
}

/* ===========================================================================
 * SAYING IT IN WORDS
 * ======================================================================== */

/**
 * What a sale will do, before it does it.
 *
 * Written to be read by somebody who has never heard the phrase "cost basis".
 * The parcels are named by when they were bought, because that is how people
 * remember them — "the ones I got in January", not "lot 3".
 */
export function describeDisposal(
  result: DisposalResult,
  input: {
    symbol: string;
    quantity1e8: number;
    cashAccountName: string;
    format: (amount: Minor) => string;
    formatDate: (iso: string) => string;
  },
): string {
  const shares = formatQuantity(input.quantity1e8);
  const oldest = result.relieved[0];

  const opening =
    `Selling ${shares} ${shares === '1' ? 'share' : 'shares'} of ${input.symbol} will ` +
    `return ${input.format(result.totalProceeds)} to your ${input.cashAccountName}.`;

  if (!oldest) return opening;

  // No preposition in front of the date: the formatter returns "Today" and
  // "Monday" as readily as "15 January", and there is no single word that
  // works before all three. The app already writes "Last valued Today" and
  // "priced Today" elsewhere, so this matches.
  const across =
    result.relieved.length === 1
      ? `the shares you bought ${input.formatDate(oldest.acquiredDate)}`
      : `${result.relieved.length} parcels, starting with the ones you bought ` +
        `${input.formatDate(oldest.acquiredDate)}`;

  if (result.realizedGain === 0) {
    return `${opening} They are worth exactly what you paid for them, so nothing is made or lost.`;
  }

  const outcome =
    result.realizedGain > 0
      ? `This locks in a gain of ${input.format(result.realizedGain)}`
      : `This locks in a loss of ${input.format(minor(-result.realizedGain))}`;

  return `${opening} ${outcome} across ${across}.`;
}

/** What the sale does to the budget, which is the part people are surprised by. */
export function describeBudgetEffect(
  proceeds: Minor,
  format: (amount: Minor) => string,
): string {
  return (
    `The ${format(proceeds)} becomes money waiting to be given a job, so what is safe to ` +
    `spend goes up by that much. None of it counts as income. It is your own money coming ` +
    `back to you in a different form.`
  );
}
