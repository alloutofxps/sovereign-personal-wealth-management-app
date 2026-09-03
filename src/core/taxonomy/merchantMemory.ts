/* ===========================================================================
 * REMEMBERING WHERE YOU FILE THINGS
 * ---------------------------------------------------------------------------
 * The loudest complaint about every budgeting app is not a missing feature; it
 * is the grind of categorising the same shop for the fortieth time. This is
 * the cheapest possible answer to it: look at what you did last time.
 *
 * No model, no service, no training. A count over your own history, which is
 * already on the device and already indexed. It is right often enough to turn
 * most of a review queue into single taps, and when it is unsure it says
 * nothing rather than guessing — a wrong pre-selection that gets confirmed by
 * reflex is worse than no pre-selection at all.
 * ======================================================================== */

/** One past decision about a merchant. */
export interface MerchantHistoryRow {
  categoryId: string;
  envelopeId: string;
  categoryName: string;
  /** 'YYYY-MM-DD'. Only used to prefer recent habits over old ones. */
  date: string;
}

export interface PredictionResult {
  categoryId: string;
  envelopeId: string;
  categoryName: string;
  /** 0–1. The share of past filings that went to this category. */
  confidence: number;
  /** How many past payments the guess is based on. */
  sampleSize: number;
}

/** Below this, the history is too thin or too mixed to say anything. */
export const MIN_SAMPLES = 2;
export const MIN_CONFIDENCE = 0.75;

const BANK_NOISE = new Set([
  'REF', 'POS', 'TXN', 'TRN', 'CRD', 'CARD', 'VISA', 'MASTERCARD', 'CONTACTLESS',
  'DEBIT', 'CREDIT', 'PURCHASE', 'ON', 'AT',
  // Sovereign's own wording. An entry's description is a sentence — "Paid
  // Waterstones." — and the merchant has to be recoverable from it, or the
  // memory never matches anything typed into a payee box.
  'PAID',
]);

/**
 * Reduce a bank descriptor to the shop behind it.
 *
 * "TESCO STORES 3428 REF 998877" and "Tesco Stores 3428" are the same shop.
 * Card terminal numbers, reference numbers and punctuation all vary between
 * one visit and the next, so they are stripped before anything is compared.
 */
export function normaliseMerchant(name: string): string {
  return name
    .toUpperCase()
    .replace(/\d{3,}/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    // Words the bank adds and the shop did not. Without this, the same shop
    // normalises two ways depending on whether that particular line happened
    // to carry a reference number, and the memory never builds up.
    .filter((word) => word.length > 0 && !BANK_NOISE.has(word))
    .join(' ')
    .trim();
}

/**
 * Are these two descriptors the same shop?
 *
 * Not equality. "Waterstones" typed into a payee box and "WATERSTONES
 * BOOKSELLERS 771" off a card statement are the same place, and requiring an
 * exact match means the memory only ever recognises a shop whose descriptor
 * never varies — which is not a shop that exists.
 *
 * So one token list has to be a prefix of the other. That accepts the extra
 * words a bank tacks on the end while refusing the coincidences a plain
 * substring test would let through: "BP" is not "BPOST", because tokens are
 * compared whole.
 */
export function isSameMerchant(a: string, b: string): boolean {
  const left = normaliseMerchant(a).split(' ').filter(Boolean);
  const right = normaliseMerchant(b).split(' ').filter(Boolean);
  if (left.length === 0 || right.length === 0) return false;

  // A two-letter first token is too little to be sure of anything.
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if ((shorter[0] ?? '').length < 3) return shorter.length === longer.length && shorter[0] === longer[0];

  return shorter.every((token, index) => token === longer[index]);
}

/**
 * What this merchant is usually filed as, or null when there is no usually.
 *
 * Deliberately blunt: the most common category wins if it is at least three
 * quarters of the history and there are at least two payments to look at.
 * Anything less certain returns null and the person picks, as before.
 */
export function predictFromHistory(
  rows: readonly MerchantHistoryRow[],
): PredictionResult | null {
  if (rows.length < MIN_SAMPLES) return null;

  const tally = new Map<string, { count: number; row: MerchantHistoryRow }>();
  for (const row of rows) {
    const seen = tally.get(row.categoryId);
    if (seen) {
      seen.count++;
      // Keep the most recent version of the name, in case it was renamed.
      if (row.date > seen.row.date) seen.row = row;
    } else {
      tally.set(row.categoryId, { count: 1, row });
    }
  }

  let best: { count: number; row: MerchantHistoryRow } | null = null;
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best) return null;

  const confidence = best.count / rows.length;
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    categoryId: best.row.categoryId,
    envelopeId: best.row.envelopeId,
    categoryName: best.row.categoryName,
    confidence,
    sampleSize: rows.length,
  };
}

/**
 * How the hint reads under the category picker.
 *
 * A sentence, not a percentage. "83% confidence" tells somebody nothing they
 * can act on; "usually Food shopping, going by your last 6 payments" tells
 * them exactly where the suggestion came from and how much to trust it.
 */
export function describePrediction(prediction: PredictionResult): string {
  const payments = prediction.sampleSize === 1 ? 'payment' : 'payments';
  return prediction.confidence === 1
    ? `You always file this as ${prediction.categoryName.toLowerCase()}, going by your last ` +
        `${prediction.sampleSize} ${payments}.`
    : `Usually ${prediction.categoryName.toLowerCase()}, going by your last ` +
        `${prediction.sampleSize} ${payments}.`;
}
