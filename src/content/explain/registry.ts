/* ===========================================================================
 * THE REGISTRY
 * ---------------------------------------------------------------------------
 * Every explanation in the app, in one place, written to the standard in
 * types.ts.
 *
 * Each `how` was checked against the engine that actually produces the number
 * rather than against the copy it replaced. Two of them were wrong before
 * that check and are noted where they sit.
 * ======================================================================== */

import { minor } from '@/core/money';
import type { Explanation, ExplainContext, ExplainTopic } from './types';

/** A worked example only appears when every figure it needs is present. */
function need<K extends string>(
  context: ExplainContext,
  keys: readonly K[],
): boolean {
  return keys.every((key) => context.figures[key as keyof typeof context.figures] !== undefined);
}

export const EXPLANATIONS: Record<ExplainTopic, Explanation> = {
  /* ---------------------------------------------------------------------
   * The anchor.
   *
   * CHECKED: calculateSafeToSpend subtracts FOUR things —
   *   liquidCash − (bills + cards) − buffer − goalFunding
   * The calibration copy in the brief lists only three and leaves out the
   * money already set aside in pots. A person reading that version and doing
   * the sum themselves would not reach the figure on their own screen, so the
   * fourth subtraction is named here.
   * ------------------------------------------------------------------ */
  'safe-to-spend': {
    id: 'safe-to-spend',
    title: 'Safe to spend',
    short: 'Money you can spend this month without breaking anything.',
    how: [
      'We start with the cash sitting in your everyday accounts and savings.',
      'Then we take out the bills due before you are next paid, what you already owe on your card, the amount you asked us to keep back, and anything you have set aside in a pot.',
      'What is left is yours to spend. Spending it changes nothing you have already promised.',
    ],
    worked: (c) => {
      if (!need(c, ['liquidCash', 'safeToSpend'])) return null;
      const f = c.figures;
      const parts = [`You have ${c.money(f.liquidCash!)} you could reach today.`];
      const taken: string[] = [];
      if (f.billsDue) taken.push(`${c.money(f.billsDue)} of bills due`);
      if (f.cardsOwed) taken.push(`${c.money(f.cardsOwed)} owed on cards`);
      if (f.cushion) taken.push(`the ${c.money(f.cushion)} you keep back`);
      if (f.setAsideInPots) taken.push(`${c.money(f.setAsideInPots)} set aside in pots`);
      if (taken.length > 0) {
        parts.push(`Take off ${listOut(taken)}.`);
      }
      parts.push(`That leaves ${c.money(f.safeToSpend!)}.`);
      return parts.join(' ');
    },
    manual: 'safe-to-spend',
  },

  /* ---------------------------------------------------------------------
   * CHECKED: calculatePacing compares elapsedPercent against spentPercent,
   * where the denominator is `spent + remaining` — what has gone plus what is
   * still safe. Not a fixed budget. TOLERANCE is 6 points.
   * ------------------------------------------------------------------ */
  pace: {
    id: 'pace',
    title: 'Spending pace',
    short: 'Whether your money is going faster than the days are.',
    how: [
      'Two fractions side by side: how much of the month has passed, and how much of your money has gone.',
      'Halfway through the month with half of it left means the two are level.',
      'If the money is going faster, tomorrow’s daily figure gets smaller on its own. Nothing is flagged and nothing has failed.',
    ],
    worked: (c) => {
      if (!need(c, ['elapsedPercent', 'spentPercent'])) return null;
      const f = c.figures;
      const elapsed = Math.round(f.elapsedPercent!);
      const spent = Math.round(f.spentPercent!);
      const gap = spent - elapsed;
      const verdict =
        Math.abs(gap) <= 6
          ? 'which is level'
          : gap > 0
            ? `so the money is ${gap} points ahead of the days`
            : `so the money is ${Math.abs(gap)} points behind the days`;
      return `${elapsed}% of the month has passed and ${spent}% of your money has gone, ${verdict}.`;
    },
    manual: 'safe-to-spend',
  },

  cushion: {
    id: 'cushion',
    title: 'Your safety cushion',
    short: 'An amount we never count as spendable, so a forgotten payment cannot overdraw you.',
    how: [
      'You pick the figure. It stays in your account and never appears in what is safe to spend.',
      'Set it to 200 and every safe-to-spend figure is 200 lower than the cash you actually hold.',
      'Nothing is moved anywhere. It is a line we refuse to cross.',
    ],
    worked: (c) => {
      if (!need(c, ['cushion', 'liquidCash'])) return null;
      const f = c.figures;
      if (f.cushion === 0) return null;
      return `Yours is ${c.money(f.cushion!)}. Of the ${c.money(f.liquidCash!)} you can reach, that much is never offered.`;
    },
    manual: 'safe-to-spend',
  },

  /* ---------------------------------------------------------------------
   * "Envelope" is a banned word, and the title has to do the defining. The
   * feature is named for a physical practice most people have never seen.
   * ------------------------------------------------------------------ */
  envelopes: {
    id: 'envelopes',
    title: 'Giving money a job',
    short: 'Your month’s money divided up before you spend it, so each part answers for itself.',
    how: [
      'You decide how much of this month goes to food, to getting around, to going out.',
      'Each amount then tracks its own spending, so running low on one does not quietly eat another.',
      'Nothing moves between your accounts. It is a plan laid over money you already have.',
    ],
    worked: (c) => {
      if (!need(c, ['assignedThisPeriod', 'readyToAssign'])) return null;
      const f = c.figures;
      return f.readyToAssign === 0
        ? `You have given all ${c.money(f.assignedThisPeriod!)} of this period a job.`
        : `You have given ${c.money(f.assignedThisPeriod!)} a job so far. ${c.money(f.readyToAssign!)} is still waiting for one.`;
    },
    manual: 'pots',
  },

  cover: {
    id: 'cover',
    title: 'Covering a shortfall',
    short: 'Moving this month’s money from something with room to something that ran out.',
    how: [
      'Going out has spent 8 more than it was given. Getting around has 60 spare.',
      'Move 8 across and both are square again.',
      'Your bank balance does not change. Only the plan does.',
    ],
    worked: (c) => {
      if (!need(c, ['coverShortfall', 'coverAvailable'])) return null;
      const f = c.figures;
      if (f.coverShortfall === 0) return null;
      return f.coverAvailable === 0
        ? `This one is ${c.money(f.coverShortfall!)} over, and nothing else has room to cover it.`
        : `This one is ${c.money(f.coverShortfall!)} over. There is ${c.money(f.coverAvailable!)} with room elsewhere.`;
    },
    manual: 'pots',
  },

  /* ---------------------------------------------------------------------
   * CHECKED: netWorthHistory never projects forward, and the dashed line on
   * that chart is a past savings rate rather than a forecast. The third
   * sentence is load-bearing and stays.
   * ------------------------------------------------------------------ */
  'net-worth': {
    id: 'net-worth',
    title: 'What you are worth',
    short: 'Everything you own, minus everything you owe.',
    how: [
      'Your accounts, your investments, and anything you have said is worth something, added together.',
      'Then your cards, your loans and your mortgage taken off.',
      'The line only shows where you have actually been. It is never a guess about where you are going.',
    ],
    worked: (c) => {
      if (!need(c, ['totalAssets', 'totalDebts', 'netWorth'])) return null;
      const f = c.figures;
      return `You hold ${c.money(f.totalAssets!)} and owe ${c.money(f.totalDebts!)}, which leaves ${c.money(f.netWorth!)}.`;
    },
  },

  /* Calibration copy from the brief, kept as written. */
  'two-books': {
    id: 'two-books',
    title: 'Why every payment is stored twice',
    short: 'Sovereign records where money went and what it was for, separately.',
    how: [
      'One record says 42 left your current account. The other says it was groceries.',
      'The two have to add up to the same number.',
      'That is how the app notices a mistake instead of quietly losing 42.',
    ],
    manual: 'two-books',
  },

  /* ---------------------------------------------------------------------
   * CHECKED against sinkingFund.ts:
   *   MonthlyAllocation = (Target − BalanceAtCycleStart) ÷ MonthsRemaining
   * fixed for the cycle and recomputed at rollover. The worked arithmetic
   * below holds: 600 over six months asks 100; after paying 100 the next
   * month is (600−100)/5, which is 100 again.
   *
   * The three pot shapes — by a date, every month, open-ended — are a real
   * distinction that will not fit in three sentences. They live in the
   * chapter rather than being flattened into one here.
   * ------------------------------------------------------------------ */
  pots: {
    id: 'pots',
    title: 'Saving up for something',
    short: 'Money set aside each month for a cost that does not arrive every month.',
    how: [
      'Car insurance is 600 in March. Six months out, we ask for 100 a month.',
      'Pay in the 100 and next month still asks for 100 — reaching for the target never moves it.',
      'Fall behind and next month asks for more. Get ahead and it asks for less.',
    ],
    worked: (c) => {
      if (!need(c, ['potsMonthlyTotal'])) return null;
      const f = c.figures;
      if (f.potsMonthlyTotal === 0) return null;
      const left = f.potsStillNeeded;
      return left === undefined || left === 0
        ? `Yours ask for ${c.money(f.potsMonthlyTotal!)} a month altogether, and this month is covered.`
        : `Yours ask for ${c.money(f.potsMonthlyTotal!)} a month altogether. ${c.money(left)} of that is still to go in this month.`;
    },
    manual: 'pots',
  },

  /* ---------------------------------------------------------------------
   * CHECKED: card balances are subtracted from safe-to-spend, and account
   * classes in AMORTIZING_CLASSES — mortgages — are excluded from that and
   * from the forecast. The third sentence is the part that stops this being
   * a half-truth.
   * ------------------------------------------------------------------ */
  cards: {
    id: 'cards',
    title: 'Money owed on a card',
    short: 'What is on your card today comes off what is safe to spend, because you will pay it.',
    how: [
      'You have 3,700 in the bank and 248 on the card.',
      'We treat that as 3,452, because the 248 is already spent — it is only the payment that has not happened yet.',
      'A mortgage is not treated this way. You were never going to clear it this month, and pretending otherwise would make every figure wrong.',
    ],
    worked: (c) => {
      if (!need(c, ['liquidCash', 'cardsOwed'])) return null;
      const f = c.figures;
      if (f.cardsOwed === 0) return null;
      return `You owe ${c.money(f.cardsOwed!)} on cards, so of the ${c.money(f.liquidCash!)} you hold, that much is already spoken for.`;
    },
    manual: 'cards',
  },

  /* ---------------------------------------------------------------------
   * Calibration copy from the brief. CHECKED against relieveLotsFIFO: oldest
   * parcel first, and a partly sold parcel keeps a proportional share of what
   * it cost. Ten at 80 plus two at 100 is 1,000, which is the figure quoted.
   *
   * The proportional cost on a partly sold parcel is the caveat that will not
   * compress. It is in the chapter.
   * ------------------------------------------------------------------ */
  selling: {
    id: 'selling',
    title: 'Which units you sold',
    short: 'When you sell part of a holding, we assume the oldest units went first.',
    how: [
      'You bought 10 at 80, then 10 more at 100. You sell 12.',
      'We count that as all ten of the 80 units and two of the 100 ones, so the gain is worked out against 1,000 of what you paid.',
      'Most tax offices expect this order, which is why it is the default.',
    ],
    /*
     * Read from the same preview the sheet shows and the sale records, so the
     * example cannot drift from the entry. It appears only once a quantity has
     * been typed, because before that there is no sale to describe.
     */
    worked: (c) => {
      if (!need(c, ['saleParcels', 'saleCostRelieved', 'saleGain'])) return null;
      const f = c.figures;
      const parcels = f.saleParcels!;
      const gain = f.saleGain!;
      const from =
        parcels === 1
          ? 'The units come out of one parcel'
          : `The units come out of your ${parcels} oldest parcels`;
      return (
        `${from}, which cost ${c.money(f.saleCostRelieved!)}. ` +
        (gain === 0
          ? 'That is exactly what they are selling for, so there is no gain.'
          : gain > 0
            ? `Selling at more than that realises a gain of ${c.money(minor(gain))}.`
            : `Selling at less than that takes a loss of ${c.money(minor(-gain))}.`)
      );
    },
    manual: 'selling',
  },

  /* ---------------------------------------------------------------------
   * CHECKED: reconciliationMath excludes pending lines entirely, and the
   * match has to be exact — no tolerance. Both facts are in the copy because
   * both are the reason the feature is worth doing.
   * ------------------------------------------------------------------ */
  checking: {
    id: 'checking',
    title: 'Checking against your bank',
    short: 'Ticking off what your bank has settled, until your figure and theirs match exactly.',
    how: [
      'Type in the closing balance from your statement.',
      'Tick off everything the statement lists. If the two numbers meet, your records are right — not close, exactly right.',
      'Payments that have not gone through yet are left out, because your statement cannot contain them either.',
    ],
    worked: (c) => {
      if (!need(c, ['statementDifference'])) return null;
      const f = c.figures;
      return f.statementDifference === 0
        ? 'The two agree exactly, which is what finishing looks like.'
        : `The two are ${c.money(minor(Math.abs(f.statementDifference!)))} apart. Something on one side is not on the other.`;
    },
    manual: 'checking',
  },

  /* ---------------------------------------------------------------------
   * THE ONE THAT WOULD NOT SIMPLIFY.
   *
   * This answers two different questions depending on where somebody is
   * taxed, and they are not variations on a theme:
   *
   *   flat_gains     tax on the growth, when you sell. There is a liability
   *                  waiting inside the gain.
   *   deemed_return  a charge every year on what you hold, whether it grew or
   *                  not. There is NOTHING waiting inside the gain.
   *
   * A `short` saying "if you sold today, part of the gain would go in tax" is
   * plainly false under the second, and that is the regime this household
   * lives under. So `short` and `how` are written to be true of both, and the
   * regime-specific arithmetic is in `worked()`, which knows which one is on.
   * ------------------------------------------------------------------ */
  'deferred-tax': {
    id: 'deferred-tax',
    title: 'Tax inside what you hold',
    short: 'The part of what you hold that would go in tax rather than staying yours.',
    how: [
      'Where you are taxed decides the sum, and the two shapes are not alike.',
      'Taxed on growth when you sell: what your investments are worth now, less what they cost, less any yearly allowance, at your rate.',
      'Charged every year on what you hold: nothing is waiting inside the gain, and there is a bill each year whether it grew or not.',
    ],
    worked: (c) => {
      const f = c.figures;
      if (f.taxRegime === 'flat_gains') {
        if (!need(c, ['portfolioValue', 'portfolioCost', 'taxAmount'])) return null;
        const gain = minor(Math.max(0, f.portfolioValue! - f.portfolioCost!));
        if (gain === 0) {
          return `Your investments are worth ${c.money(f.portfolioValue!)} and cost ${c.money(f.portfolioCost!)}, so there is no gain to tax.`;
        }
        const relief = f.reliefApplied
          ? ` After the ${c.money(f.reliefApplied)} a year that is not taxed, that comes to`
          : ' That comes to';
        return `Your investments are worth ${c.money(f.portfolioValue!)} and cost ${c.money(f.portfolioCost!)}, so ${c.money(gain)} of it is growth.${relief} ${c.money(f.taxAmount!)}.`;
      }
      if (f.taxRegime === 'dutch_box3') {
        if (!need(c, ['taxAmount'])) return null;
        return `Where you are taxed, the charge is on what you hold rather than on what it gained: ${c.money(f.taxAmount!)} a year as things stand.`;
      }
      return null;
    },
    manual: 'selling',
  },

  /* ---------------------------------------------------------------------
   * CHECKED: feeDrag weights each holding's charge by its size, compares
   * against LOW_COST_BASELINE_BP of 15 (0.15%), and projects at
   * ASSUMED_GROSS_RETURN_BP of 700 over 10, 20 and 30 years.
   * ------------------------------------------------------------------ */
  'fee-drag': {
    id: 'fee-drag',
    title: 'What the funds charge',
    short: 'A yearly slice of everything you hold, taken out before the price you see.',
    how: [
      'Each fund charges a percentage a year. We weigh them by how much of each you hold.',
      'No bill ever arrives — it comes out of the fund’s value before the price is published, which is why nobody notices it.',
      'Held for thirty years, the difference between a cheap fund and an expensive one is routinely a fifth of what you end up with.',
    ],
    worked: (c) => {
      if (!need(c, ['feeBp', 'portfolioValue', 'feeThisYear'])) return null;
      const f = c.figures;
      const percent = (f.feeBp! / 100).toFixed(2).replace(/\.?0+$/, '');
      return `You are paying ${percent}% a year across what you hold. On ${c.money(f.portfolioValue!)} that is ${c.money(f.feeThisYear!)} this year.`;
    },
  },

  /* ---------------------------------------------------------------------
   * CHECKED: rebalance.ts computes both routes and recommends neither. The
   * deposit route is offered first because it costs nothing; the sale route
   * is shown with what it would realise. "Drift" and "allocation" are banned
   * words and neither appears.
   * ------------------------------------------------------------------ */
  rebalance: {
    id: 'rebalance',
    title: 'Getting back to your mix',
    short: 'One part of your investments grew faster, so the mix is no longer the one you chose.',
    how: [
      'You wanted 60 in every 100 in shares. Shares did well, so you are now at 70.',
      'Putting your next deposit into whatever is furthest behind gets you back without selling anything.',
      'Selling the part that grew also works, and turns a gain into one you may owe tax on.',
    ],
    /*
     * The class that is furthest off, in the same hundreds the copy above
     * uses. `mixDepositToFix` is what the deposit route would take, which is
     * the route offered first because it sells nothing.
     */
    worked: (c) => {
      if (!need(c, ['mixCurrentBp', 'mixTargetBp'])) return null;
      const f = c.figures;
      const current = Math.round(f.mixCurrentBp! / 100);
      const target = Math.round(f.mixTargetBp! / 100);
      if (current === target) return null;
      const fix =
        f.mixDepositToFix === undefined || f.mixDepositToFix === 0
          ? ''
          : ` Putting ${c.money(f.mixDepositToFix)} into what is behind closes it without ` +
            'selling anything.';
      return (
        `One part of your mix is at ${current} in every 100 where you wanted ${target}.` + fix
      );
    },
  },

  /* ---------------------------------------------------------------------
   * "Runway" is a banned word and does not appear. CHECKED against
   * calculateRunway: usable cash divided by what a month costs, where a month
   * is thirty days.
   * ------------------------------------------------------------------ */
  runway: {
    id: 'runway',
    title: 'How long your money would last',
    short: 'If nothing came in from tomorrow, how long what you have would cover what you spend.',
    how: [
      'What you could reach today, divided by what a normal month costs you.',
      'Switch off the things you could stop and the same money stretches further.',
      'It is a what-if, not a plan. Nothing here changes anything you have recorded.',
    ],
    worked: (c) => {
      if (!need(c, ['usableCash', 'monthlyNeed'])) return null;
      const f = c.figures;
      if (f.monthlyNeed === 0) return null;
      const months = f.runwayMonths ?? Math.floor(f.usableCash! / f.monthlyNeed!);
      return `You could reach ${c.money(f.usableCash!)} and a month costs ${c.money(f.monthlyNeed!)}, so about ${months} ${months === 1 ? 'month' : 'months'}.`;
    },
  },

  /* ---------------------------------------------------------------------
   * CHECKED: generateMnemonic defaults to 12 words, and the phrase is turned
   * into the key that encrypts an export. There is no recovery path.
   * ------------------------------------------------------------------ */
  'recovery-phrase': {
    id: 'recovery-phrase',
    title: 'Your recovery phrase',
    short: 'Twelve words that unlock a backup file. Nobody can reset them for you.',
    how: [
      'The words become the key that locks your backup.',
      'The same twelve words in the same order make the same key, on any device.',
      'Lose them and the backup cannot be opened. There is no copy anywhere else, and nobody to ask.',
    ],
  },

  storage: {
    id: 'storage',
    title: 'Keeping your records',
    short: 'Asking your browser not to clear your data when the device runs short of space.',
    how: [
      'Everything you record is kept on this device and nowhere else.',
      'When storage runs low a browser clears data to make room, and it does not ask first.',
      'Granting permanent storage tells yours to leave Sovereign alone. It sends nothing anywhere — there is nowhere for it to go.',
    ],
    worked: (c) => {
      const used = c.figures.storageUsedBytes;
      if (used === undefined || used <= 0) return null;
      const mb = used / (1024 * 1024);
      return `Your records take about ${mb < 1 ? 'less than a megabyte' : mb.toFixed(1) + ' MB'} on this device.`;
    },
  },

  /* ---------------------------------------------------------------------
   * CHECKED: taxRegime is 'none' | 'dutch_box3' | 'flat_gains', and the card
   * renders nothing at all under 'none'. The two shapes really are unalike;
   * see the note on 'deferred-tax'.
   * ------------------------------------------------------------------ */
  'tax-regime': {
    id: 'tax-regime',
    title: 'Where you are taxed',
    short: 'Which country’s rules to use when showing what tax would take.',
    how: [
      'Some places tax the growth when you sell it. Some charge an amount every year on what you hold, whether it grew or not.',
      'Those two produce completely different figures, so Sovereign asks rather than guesses.',
      'Leave it off and no tax figure is shown anywhere.',
    ],
  },

  /* ---------------------------------------------------------------------
   * CHECKED against onUnrealisedGain: the allowance comes off the gain first,
   * then the rate applies to what is left. Doing it the other way round would
   * overstate the bill.
   * ------------------------------------------------------------------ */
  cgt: {
    id: 'cgt',
    title: 'Your rate and allowance',
    short: 'The share taken from a gain, and how much gain each year is free of it.',
    how: [
      'The allowance comes off the gain first. The rate then applies to whatever is left.',
      'A gain of 9,180 with an allowance of 1,270 leaves 7,910 to be taxed.',
      'Both change from year to year, which is why they are yours to set rather than ours to assume.',
    ],
    worked: (c) => {
      if (!need(c, ['cgtRateBp', 'cgtExemption'])) return null;
      const f = c.figures;
      const rate = (f.cgtRateBp! / 100).toFixed(2).replace(/\.?0+$/, '');
      return `Yours is ${rate}%, with ${c.money(f.cgtExemption!)} a year free of it.`;
    },
    manual: 'selling',
  },
};

/** "a, b and c" — so a list of subtractions reads as a sentence. */
function listOut(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
