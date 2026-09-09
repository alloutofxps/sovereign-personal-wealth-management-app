import { describe, expect, it } from 'vitest';
import { minor, type Minor } from '@/core/money';
import { EXPLANATIONS } from './registry';
import type { ExplainContext, ExplainTopic } from './types';

/* ===========================================================================
 * THE COPY STANDARD, ENFORCED
 * ---------------------------------------------------------------------------
 * The register is the whole point of this system, and register is exactly the
 * thing that decays first — one explanation written in a hurry sounds like the
 * engine that produces it, and then the next one matches that. So the rules
 * are checked rather than remembered.
 * ======================================================================== */

const ALL = Object.values(EXPLANATIONS);
const TOPICS = Object.keys(EXPLANATIONS) as ExplainTopic[];

/** The six chapter slugs, from src/features/manual/chapters/slugs.ts. */
const CHAPTERS = ['safe-to-spend', 'two-books', 'pots', 'cards', 'selling', 'checking'];

/**
 * Words that name a concept the reader does not have yet.
 *
 * Allowed only if the same sentence defines them, which in practice means
 * they are allowed in a title that is doing the defining and nowhere else.
 */
const JARGON = [
  'envelope',
  'pacing',
  'disposal',
  'fifo',
  'cost basis',
  'deferred tax',
  'runway',
  'posting',
  'double-entry',
  'reconcile',
  'accrual',
  'amortisation',
  'amortization',
  'drift',
  'allocation',
  'liquidity',
];

/** Hedges and apologies. An explanation that hedges has not explained. */
const HEDGES = ['simply', 'just ', 'sorry', 'unfortunately', 'please note', 'of course'];

describe('every topic is complete and consistent', () => {
  it('keys match ids', () => {
    for (const topic of TOPICS) {
      expect(EXPLANATIONS[topic].id).toBe(topic);
    }
  });

  it('covers all twenty-eight', () => {
    expect(TOPICS).toHaveLength(28);
  });

  it('points every manual link at a real chapter', () => {
    for (const entry of ALL) {
      if (entry.manual) {
        expect(CHAPTERS, `${entry.id} links to a chapter that does not exist`).toContain(
          entry.manual,
        );
      }
    }
  });
});

describe('the copy standard holds', () => {
  /*
   * Six words, not the four the brief's interface comment says.
   *
   * The brief sets the limit at four and then gives, as one of the three
   * calibration examples the register is meant to match exactly, the title
   * "Why every payment is stored twice" — which is six. One of the two had to
   * give, and the calibration is the more considered artefact: that title is a
   * question somebody actually has, and every four-word alternative loses the
   * "why". Fifteen of the nineteen still come in at four or under.
   */
  it('keeps every title to six words in sentence case', () => {
    for (const entry of ALL) {
      const words = entry.title.split(/\s+/);
      expect(words.length, `${entry.id}: "${entry.title}"`).toBeLessThanOrEqual(6);
      // Sentence case: only the first word may be capitalised, bar proper nouns.
      const shouty = words.slice(1).filter((w) => /^[A-Z]/.test(w) && w !== 'Sovereign');
      expect(shouty, `${entry.id} title is not sentence case`).toEqual([]);
    }
  });

  it('keeps every short answer to twenty words', () => {
    for (const entry of ALL) {
      const words = entry.short.split(/\s+/).filter(Boolean);
      expect(words.length, `${entry.id}: "${entry.short}"`).toBeLessThanOrEqual(20);
    }
  });

  it('makes every short answer a complete sentence', () => {
    for (const entry of ALL) {
      expect(entry.short, `${entry.id} does not end in a full stop`).toMatch(/[.!?]$/);
      expect(entry.short[0], `${entry.id} does not start with a capital`).toMatch(/[A-Z]/);
    }
  });

  it('keeps every how to three sentences at the outside', () => {
    for (const entry of ALL) {
      expect(entry.how.length, `${entry.id} has ${entry.how.length} lines`).toBeLessThanOrEqual(3);
      expect(entry.how.length, `${entry.id} has no how`).toBeGreaterThan(0);
    }
  });

  /*
   * Jargon is checked against `short` and `how` only.
   *
   * A title is allowed to carry a banned word precisely when it is the thing
   * doing the defining — "Tax inside what you hold" earns the right to be
   * about deferred tax by never using the phrase.
   */
  it('uses no word that names a concept the reader does not have', () => {
    const offenders: string[] = [];
    for (const entry of ALL) {
      const prose = [entry.short, ...entry.how].join(' ').toLowerCase();
      for (const word of JARGON) {
        if (prose.includes(word)) offenders.push(`${entry.id}: "${word}"`);
      }
    }
    expect(offenders, 'Define it in the same sentence or find another way to say it').toEqual([]);
  });

  /*
   * "Pot" is a named feature, not a generic container.
   *
   * Two explanations borrowed it for envelopes — "split into named pots",
   * "from a pot with room" — which is the one word in this app somebody could
   * reasonably read as pointing at a different screen. Saving up for car
   * insurance and dividing up this month's money are separate features with
   * separate sums, and a reader who has learned what a Pot is should not have
   * to unlearn it two screens later.
   *
   * Only explanations genuinely about Pots may use the word. `safe-to-spend`
   * qualifies because the money it names really is held in Pots — that
   * subtraction is `goalFunding`.
   */
  const MAY_SAY_POT: ExplainTopic[] = ['pots', 'safe-to-spend'];

  it('uses "pot" only where it means the Pots feature', () => {
    const offenders: string[] = [];
    for (const entry of ALL) {
      if (MAY_SAY_POT.includes(entry.id)) continue;
      const prose = [entry.title, entry.short, ...entry.how].join(' ').toLowerCase();
      if (/\bpots?\b/.test(prose)) offenders.push(`${entry.id}: "${entry.title}"`);
    }
    expect(
      offenders,
      'Pot is a named feature. Say what the thing actually is.',
    ).toEqual([]);
  });

  it('never hedges and never apologises', () => {
    const offenders: string[] = [];
    for (const entry of ALL) {
      const prose = [entry.short, ...entry.how].join(' ').toLowerCase();
      for (const hedge of HEDGES) {
        if (prose.includes(hedge)) offenders.push(`${entry.id}: "${hedge.trim()}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
   * Explaining the interface is the failure mode this system exists to fix.
   * "Tap here to see more" tells somebody what to press; it tells them nothing
   * about their money, which is the only thing they came to find out.
   */
  it('explains the money, never the interface', () => {
    const offenders: string[] = [];
    for (const entry of ALL) {
      const prose = [entry.short, ...entry.how].join(' ').toLowerCase();
      for (const phrase of ['tap ', 'click ', 'this screen', 'this page', 'the button', 'scroll ']) {
        if (prose.includes(phrase)) offenders.push(`${entry.id}: "${phrase.trim()}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ===========================================================================
 * WORKED EXAMPLES
 * ---------------------------------------------------------------------------
 * The rule that matters: a worked example never invents a figure. Given
 * nothing it returns null and the sheet shows only the general version, which
 * is honest. Given zeroes it must not present them as an answer.
 * ======================================================================== */

const money = (amount: Minor) => `€${(amount / 100).toFixed(2)}`;
const empty: ExplainContext = { money, figures: {} };

describe('worked examples are built from real figures or not at all', () => {
  it('returns nothing when the screen knows nothing', () => {
    for (const entry of ALL) {
      if (!entry.worked) continue;
      expect(entry.worked(empty), `${entry.id} invented an example from an empty context`).toBeNull();
    }
  });

  it('builds the safe-to-spend sum from the four real subtractions', () => {
    const worked = EXPLANATIONS['safe-to-spend'].worked!({
      money,
      figures: {
        liquidCash: minor(370_000),
        billsDue: minor(41_200),
        cardsOwed: minor(24_800),
        cushion: minor(90_000),
        setAsideInPots: minor(20_000),
        safeToSpend: minor(194_000),
      },
    });
    expect(worked).toContain('€3700.00');
    expect(worked).toContain('€412.00');
    expect(worked).toContain('€248.00');
    expect(worked).toContain('€900.00');
    // The fourth subtraction the brief's calibration copy left out.
    expect(worked, 'money set aside in pots must be named').toContain('€200.00');
    expect(worked).toContain('€1940.00');
  });

  it('leaves out a subtraction that is genuinely zero', () => {
    const worked = EXPLANATIONS['safe-to-spend'].worked!({
      money,
      figures: {
        liquidCash: minor(370_000),
        billsDue: minor(41_200),
        cardsOwed: minor(0),
        cushion: minor(0),
        setAsideInPots: minor(0),
        safeToSpend: minor(328_800),
      },
    });
    expect(worked).toContain('€412.00');
    expect(worked).not.toContain('owed on cards');
    expect(worked).not.toContain('keep back');
  });

  /*
   * The regime split is the reason this topic could not be simplified into one
   * sentence. Under a gains regime there is tax waiting inside the growth;
   * under a deemed-return regime there is not, and there is a bill every year
   * instead. Saying either one of those in both places would be false.
   */
  it('answers the tax question differently under each regime', () => {
    const gains = EXPLANATIONS['deferred-tax'].worked!({
      money,
      figures: {
        taxRegime: 'flat_gains',
        portfolioValue: minor(6_143_000),
        portfolioCost: minor(5_225_000),
        reliefApplied: minor(127_000),
        taxAmount: minor(261_030),
      },
    });
    expect(gains).toContain('growth');

    const deemed = EXPLANATIONS['deferred-tax'].worked!({
      money,
      figures: { taxRegime: 'dutch_box3', taxAmount: minor(120_000) },
    });
    expect(deemed).toContain('a year');
    expect(deemed, 'a yearly charge is not a gain waiting to be taxed').not.toContain('growth');

    expect(
      EXPLANATIONS['deferred-tax'].worked!({ money, figures: { taxRegime: 'none' } }),
    ).toBeNull();
  });

  it('says there is no gain rather than showing a negative one', () => {
    const worked = EXPLANATIONS['deferred-tax'].worked!({
      money,
      figures: {
        taxRegime: 'flat_gains',
        portfolioValue: minor(400_000),
        portfolioCost: minor(500_000),
        taxAmount: minor(0),
      },
    });
    expect(worked).toContain('no gain to tax');
  });
});
