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
  /* ---------------------------------------------------------------------
   * The last of the three unwired examples, filled in phase 4c.
   *
   * The two totals are equal by construction: invariants I1-I10 refuse a write
   * where they are not, so no entry that reached the database can print a pair
   * that differs. Saying both out loud anyway is the whole demonstration --
   * "these two agree" is a claim somebody can check against the figure they
   * just typed, where "the app keeps two sets of books" is a claim they have to
   * take on faith.
   *
   * Deliberately no branch for the unequal case. There is no honest sentence
   * for it: an entry whose books disagree could not have been saved, so copy
   * for that state would be copy for something that cannot happen.
   * ------------------------------------------------------------------ */
  'two-books': {
    id: 'two-books',
    title: 'Why every payment is stored twice',
    short: 'Sovereign records where money went and what it was for, separately.',
    how: [
      'One record says 42 left your current account. The other says it was groceries.',
      'The two have to add up to the same number.',
      'That is how the app notices a mistake instead of quietly losing 42.',
    ],
    worked: (c) => {
      if (!need(c, ['entryFinancialTotal', 'entryBudgetTotal'])) return null;
      const f = c.figures;
      const lines = f.entryPostingCount;
      const counted =
        lines === undefined
          ? ''
          : ` This one is stored as ${lines} ${lines === 1 ? 'line' : 'lines'}.`;
      return (
        `Here, the money side adds up to ${c.money(f.entryFinancialTotal!)} and the ` +
        `category side adds up to ${c.money(f.entryBudgetTotal!)}. They agree, which is ` +
        `what lets Sovereign tell a typo from a payment.${counted}`
      );
    },
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
  /* ---------------------------------------------------------------------
   * RECORDING, AND WHAT EACH KIND OF ENTRY DOES TO THE FIGURES
   * ---------------------------------------------------------------------
   * Five topics that were all inline paragraphs in the record and account
   * sheets. Each one answers the same underlying question in a different
   * place: *this thing I am about to do -- which of my numbers does it move?*
   *
   * That question is exactly why they could not stay as captions. A caption
   * says it once, beside one control, to somebody who is mid-task and skipping
   * it; a topic says it in one place and can be reached from every screen that
   * does the same thing to the same figures.
   * ------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------
   * CHECKED against claimsRepo and recordFronted: a fronted payment posts to a
   * receivable rather than to a category, so it is out of spending from the
   * moment it is recorded, and settling it credits the receivable rather than
   * income. Writing one off is the only route by which it becomes spending,
   * and it lands in the month of the write-off, not the month of the payment.
   * ------------------------------------------------------------------ */
  fronted: {
    id: 'fronted',
    title: 'Money you fronted',
    short: 'Something you paid for that somebody else owes you back. It is not your spending.',
    how: [
      'It comes out of your account, so what you can reach today goes down.',
      'It never counts as yours, so your spending and what is safe to spend do not move at all.',
      'When the money comes back it is not income either. It is your own money returning.',
    ],
    worked: (c) => {
      if (!need(c, ['claimOutstanding'])) return null;
      const f = c.figures;
      if (f.claimOutstanding === 0) return null;
      const settling = f.claimSettling;
      if (settling === undefined) {
        return (
          `${c.money(f.claimOutstanding!)} is out with other people. None of it is counted ` +
          `as money you have spent.`
        );
      }
      const left = minor(f.claimOutstanding! - settling);
      return left <= 0
        ? `Taking ${c.money(settling)} back settles this one, and nothing you appear to earn changes.`
        : `Taking ${c.money(settling)} back leaves ${c.money(left)} still out with somebody, ` +
          `and nothing you appear to earn changes.`;
    },
  },

  /* ---------------------------------------------------------------------
   * CHECKED against recordTransfer and recordCrossCurrencyTransfer: both
   * postings are asset-side, so no category and no income account is touched.
   * Across a currency the two amounts differ and the difference is booked as a
   * cost, which is the one part of a transfer that does move what you are
   * worth -- so the copy says that rather than claiming nothing changes.
   * ------------------------------------------------------------------ */
  transfers: {
    id: 'transfers',
    title: 'Moving money about',
    short: 'Money going from one of your accounts to another is not spending or earning.',
    how: [
      'Both sides are yours, so nothing was earned and nothing was spent.',
      'Your spending, your categories and how fast you are going all stay where they were.',
      'Across currencies the two amounts differ. What the bank kept is the one part that is a real cost.',
    ],
    worked: (c) => {
      if (!need(c, ['transferOut', 'transferIn'])) return null;
      const f = c.figures;
      const kept = minor(f.transferOut! - f.transferIn!);
      return kept === 0
        ? `${c.money(f.transferOut!)} moves across and arrives whole. What you are worth is unchanged.`
        : `${c.money(f.transferOut!)} leaves and ${c.money(f.transferIn!)} arrives, so ` +
          `${c.money(kept)} stayed with the bank. That much is a real cost; the rest just moved.`;
    },
  },

  /* ---------------------------------------------------------------------
   * CHECKED against the valuation entry builder: it posts the change against
   * an equity revaluation account, never against income or a category, so a
   * car losing value does not show up as a month of spending.
   * ------------------------------------------------------------------ */
  valuations: {
    id: 'valuations',
    title: 'What a thing is worth now',
    short: 'Saying what a car, a flat or a pension is worth today, without calling it income.',
    how: [
      'A house going up is not money you earned, and a car going down is not money you spent.',
      'So the new figure changes what you are worth, and changes nothing else.',
      'Your spending, your income and what is safe to spend all stay exactly as they were.',
    ],
    worked: (c) => {
      if (!need(c, ['valuationWas', 'valuationNow'])) return null;
      const f = c.figures;
      const move = minor(f.valuationNow! - f.valuationWas!);
      if (move === 0) return 'That is what it was already down as, so nothing moves at all.';
      return (
        `${c.money(f.valuationWas!)} to ${c.money(f.valuationNow!)} is ` +
        `${c.money(minor(Math.abs(move)))} ${move > 0 ? 'on' : 'off'} what you are worth, and ` +
        `nothing at all off what is safe to spend.`
      );
    },
  },

  /* ---------------------------------------------------------------------
   * CHECKED against voidEntry: it writes a reversing entry and leaves the
   * original in place. Nothing is deleted, ever, which is what makes a history
   * explainable -- and it is also why undoing an undo is a new entry rather
   * than a deletion of the correction.
   * ------------------------------------------------------------------ */
  corrections: {
    id: 'corrections',
    title: 'Undoing something',
    short: 'Nothing is deleted. A correction is a second entry that cancels the first.',
    how: [
      'Every balance goes back to where it was before you recorded the thing.',
      'Both the payment and the correction stay in your history, so the change is always explainable.',
      'That is also why undoing a correction means recording the payment again, rather than deleting anything.',
    ],
  },

  /* ---------------------------------------------------------------------
   * CHECKED against rulesRepo: a rule matches on the merchant string and sets
   * a category on new entries only. It never rewrites anything already
   * recorded, which is the fact people most need before agreeing to one.
   * ------------------------------------------------------------------ */
  rules: {
    id: 'rules',
    title: 'Filing things for you',
    short: 'Telling Sovereign that everything from one shop belongs in one category.',
    how: [
      'From then on, anything from that shop arrives already filed.',
      'It never touches anything you have already recorded. Your past months do not move.',
      'You can change it or drop it in Settings whenever you like.',
    ],
  },

  /* ---------------------------------------------------------------------
   * CHECKED against tagsRepo and every selector that reads a tag: nothing
   * does. No total, no envelope figure and nothing in safe-to-spend touches
   * one. That is the fact worth stating, because a label that quietly changed
   * a figure would be the worst kind of surprise, and people reasonably assume
   * it might.
   * ------------------------------------------------------------------ */
  tags: {
    id: 'tags',
    title: 'Tags',
    short: 'A label you put across payments that have nothing else in common.',
    how: [
      'A trip, a room, everything somebody owes you half of.',
      'Choose several payments on the transactions screen and tag them together.',
      'A tag never changes a figure. It is only how you find things again.',
    ],
  },

  /* ---------------------------------------------------------------------
   * CHECKED against core/ledger/branching: a what-if lives in its own branch
   * and no selector outside that branch reads it. The projection it draws is
   * the ordinary one run against the branch, which is why it can be trusted
   * to be the same arithmetic and why it cannot leak into the real figures.
   * ------------------------------------------------------------------ */
  'what-if': {
    id: 'what-if',
    title: 'Sketching a change',
    short: 'A different future, drawn from what you already have, and recorded nowhere.',
    how: [
      'A raise, a move, a car. Say what money would arrive or leave, and when.',
      'The line is worked out the same way the ordinary one is, from your real figures plus the change.',
      'None of it is saved. What you are worth and what is safe to spend do not move.',
    ],
  },

  /* ---------------------------------------------------------------------
   * CHECKED against core/simulate/fire: the band is a range of outcomes at
   * different return assumptions, not a confidence interval. The copy says
   * "a good or a bad run" rather than any figure that would imply a
   * probability the engine does not compute.
   * ------------------------------------------------------------------ */
  independence: {
    id: 'independence',
    title: 'When you could stop',
    short: 'How much you would need invested to live off it, and roughly how long that takes.',
    how: [
      'What a year costs you, multiplied by the number of years the money has to last.',
      'The solid line is what steady returns would give. The band is where a good or a bad run of markets could put you.',
      'The width of that band is the honest part. Real markets do not move in a straight line.',
    ],
  },

  /* ---------------------------------------------------------------------
   * CHECKED against the ingest pipeline: parsing happens in this tab and
   * nothing is sent anywhere, which is the claim people most need before
   * handing over a statement. The day-first question is genuinely undecidable
   * from some files, so the copy asks rather than guessing.
   * ------------------------------------------------------------------ */
  importing: {
    id: 'importing',
    title: 'Reading a statement',
    short: 'A CSV from your bank, read on this device and sent nowhere.',
    how: [
      'Most banks offer one somewhere in their statements section.',
      'It is read here in this tab. Nothing is uploaded and no bank details are needed.',
      'Some files do not say whether a date is day-first or month-first, so Sovereign asks rather than guessing.',
    ],
  },

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

  /* ---------------------------------------------------------------------
   * LOOKING BACK, AND GETTING OUT FROM UNDER
   *
   * The last two topics, and both were written from the engine outwards
   * rather than from the screen inwards. Nine of the ten steps drafted from
   * what the screens display were wrong or incomplete, in the same two ways
   * safe-to-spend and the deemed return were wrong: a figure whose name is
   * not what it holds, and a rate that does not annualise by multiplying.
   * ------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------
   * CHECKED against buildSankeyFlow, and it moved every step.
   *
   *   income  = sum of positive income slices, FINANCIAL book
   *   spent   = sum of positive spend slices, FINANCIAL book, refunds
   *             already netted per category by the selector's SUM, and any
   *             category netting to zero or less dropped by its HAVING
   *   saved   = sum of positive pot slices, BUDGET book -- `assign` is
   *             "Budget book only, no cash actually moves"
   *   retained = income - spent - saved, SIGNED
   *   totalIn  = income + max(0, spent + saved - income)
   *
   * Three things that had to change. `totalIn` is not income and may not be
   * described as money that came in. `saved` has not left anything, so the
   * second step says "kept back" rather than "went out". And `retained` is
   * not what is in the account -- the cash still there is `income - spent`,
   * and this figure is what has no job yet, which is a different sentence.
   *
   * The folding of small slices into "Everything else" and the dropped
   * net-negative category are real and do not fit in three steps. They are
   * caveats, so they go to the manual chapter per the note in types.ts, and
   * `two-books` is the right one because the book split is why `saved` is
   * counted at all.
   * ------------------------------------------------------------------ */
  'where-it-went': {
    id: 'where-it-went',
    title: 'Where your money went',
    short: 'What arrived over a stretch of time, what you spent, and what you kept back.',
    how: [
      'We add up everything that arrived, then everything you spent — with anything you got back already taken off.',
      'Money you told us to keep for something later is counted too, even though it has not left your account. It has a job, so it is not spare.',
      'What is left over has no job yet. If you did more with the money than arrived, the difference was already there before the period started.',
    ],
    worked: (c) => {
      if (!need(c, ['periodIncome', 'periodSpent', 'periodRetained'])) return null;
      const f = c.figures;
      const saved = f.periodSaved ?? minor(0);
      if (f.periodIncome === 0 && f.periodSpent === 0 && saved === 0) return null;

      const did = [`spent ${c.money(f.periodSpent!)}`];
      if (saved > 0) did.push(`kept ${c.money(saved)} back`);

      const opening = `${c.money(f.periodIncome!)} arrived and you ${listOut(did)}`;

      // Signed, and the wording turns on it. The screen printed "Nothing"
      // for everything at or below zero, which read a deficit as break-even.
      if (f.periodRetained! > 0) {
        return `${opening}, which leaves ${c.money(f.periodRetained!)} with no job yet.`;
      }
      if (f.periodRetained! < 0) {
        return `${opening} — ${c.money(minor(-f.periodRetained!))} more than arrived, which was money you already had.`;
      }
      return `${opening}, which is every penny of it and nothing spare.`;
    },
    manual: 'two-books',
  },

  /* ---------------------------------------------------------------------
   * CHECKED against simulatePayoff, and the month runs in three steps in
   * this order:
   *
   *   1. interest on EVERY outstanding balance, before anything is paid
   *   2. the minimum on EVERY debt, so none falls behind
   *   3. only what is left of the budget goes at one target, chosen by
   *      `orderFor` -- APR descending, or balance ascending
   *
   * The draft had the whole payment going at the highest-rate debt, which is
   * how these plans are usually described and is not what happens to the
   * money. The extra is the third slice only.
   *
   * `monthlyInterest` is `balance x apr / (10000 x 12)`: the simple
   * one-twelfth convention a statement uses. So a year's interest is NOT the
   * rate times the balance -- each month's charge lands on a balance the
   * previous month's payment already moved, and the total is the
   * simulation's result. This is the deemed-return mistake exactly, and the
   * worked example states one month's charge and nothing annualised.
   *
   * Two branches that only exist in the engine: `months` is null past 600
   * months, and when the budget is under `totalMinimum` step 2 pays
   * `min(budget, minimum, owed)` in Map insertion order, so some debts get
   * nothing. The code comment there says "so nothing falls into arrears",
   * which holds only above the minimum -- so the copy says so.
   * ------------------------------------------------------------------ */
  payoff: {
    id: 'payoff',
    title: 'Clearing what you owe',
    short: 'How long your debts take to clear, and what the waiting costs in interest.',
    how: [
      'Interest goes on first, the way a lender does it: a year’s rate split into twelve, charged on what you still owe.',
      'Then the smallest payment each debt will accept, so none of them falls behind.',
      'Everything left over goes at one debt until it is gone, then rolls onto the next. That last part is what actually clears the debt.',
    ],
    worked: (c) => {
      if (!need(c, ['debtTotal', 'debtMonthlyPayment'])) return null;
      const f = c.figures;
      if (f.debtTotal === 0) return null;

      const opening = `You owe ${c.money(f.debtTotal!)} and put ${c.money(f.debtMonthlyPayment!)} towards it a month`;

      // Below the total minimum nothing clears and something falls behind, so
      // this branch comes before the never-clears one: it is the reason.
      if (f.debtMinimumTotal !== undefined && f.debtMonthlyPayment! < f.debtMinimumTotal) {
        return `${opening}, but the smallest payments alone come to ${c.money(f.debtMinimumTotal)}. Some of them would fall behind.`;
      }

      const charge =
        f.debtInterestThisMonth !== undefined && f.debtInterestThisMonth > 0
          ? ` This month’s interest alone is ${c.money(f.debtInterestThisMonth)}.`
          : '';

      if (f.debtMonthsToClear === null) {
        return `${opening}. That never gets ahead of the interest, so it does not clear.${charge}`;
      }
      if (f.debtMonthsToClear === undefined || f.debtTotalInterest === undefined) {
        return `${opening}.${charge}`;
      }

      const months = f.debtMonthsToClear;
      return `${opening}, so you are clear in ${months} ${months === 1 ? 'month' : 'months'} and the interest costs ${c.money(f.debtTotalInterest)} on the way.${charge}`;
    },
    manual: 'cards',
  },
};

/** "a, b and c" — so a list of subtractions reads as a sentence. */
function listOut(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
