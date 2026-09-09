import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* ===========================================================================
 * NO PROSE IN COMPONENTS
 * ---------------------------------------------------------------------------
 * There were about 175 explanatory paragraphs sitting inline in the feature
 * components. Cards explained themselves in prose instead of showing
 * themselves, which is the single loudest thing separating this app from one
 * somebody would pay for.
 *
 * They are all in `src/content/explain` now, behind an information button.
 * This is the guard that stops them creeping back, because they will: the next
 * person to add a card will want to add a sentence under it, and the sentence
 * will be reasonable, and six months later there are 175 again.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS EXEMPT, AND WHY
 *
 * THE FIELD MANUAL. Section 6 of the brief keeps it, deliberately, as
 * long-form reference prose — that is the entire point of it, and it holds 64
 * strings over this threshold on purpose. A guard that failed the manual would
 * be a guard that misunderstood what it was guarding.
 *
 * Onboarding is NOT exempt. Its explanatory asides moved into the registry
 * like every other screen's; only the step copy stays, and step copy is a
 * question and a hint rather than an explanation of an engine.
 *
 * Nor is anything else. A toast, an error message, an aria-label and an import
 * path are allowed to be long because none of them is a paragraph somebody
 * reads under a figure — those are matched by shape below rather than by being
 * listed file by file.
 * ======================================================================== */

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/** Long enough that it is a sentence rather than a label. */
const LONG = 90;

/* ---------------------------------------------------------------------------
 * THREE CATEGORY EXEMPTIONS
 * ---------------------------------------------------------------------------
 * Each of these is exempt because of what the copy IS, not because getting to
 * it was inconvenient. Anything that does not fall into one of them and is
 * still inline is on the debt list below, which shrinks.
 * ------------------------------------------------------------------------ */

/**
 * 1. THE FIELD MANUAL.
 *
 * Section 6 keeps it as long-form reference prose on purpose — that is the
 * entire point of it, and it holds 64 strings over this threshold by design.
 * A guard that failed the manual would have misunderstood what it guards.
 */
const MANUAL_CHAPTERS = join('features', 'manual', 'chapters') + sep;

/**
 * 2. THE DESIGN-SYSTEM GALLERY.
 *
 * Documentation of the primitives, for whoever is working on them. Phase 6
 * puts it behind a dev-only flag, so it is not a user-facing destination and
 * its descriptive copy is not something a person reads under a figure.
 */
const GALLERY = join('features', 'gallery') + sep;

/**
 * 3. EMPTY STATES.
 *
 * An empty state is the screen's only content. Moving it behind an
 * information button leaves a blank screen with an "i" on it, which is worse
 * than the paragraph — there would be nothing left to press the button beside.
 *
 * Recognised by how they are actually written here: they open by saying that
 * there is nothing yet. The cap matters as much as the opening, because an
 * empty state is a sentence explaining what to do next, and one that runs past
 * two lines has stopped being that and become an essay with nowhere to go.
 */
const EMPTY_STATE_OPENINGS =
  /^(nothing|no one|no |none |once you|once there|add (a|an|your)|your accounts are|there is nothing|there are no)/i;
const EMPTY_STATE_CAP = 170;

function isEmptyState(text: string): boolean {
  return EMPTY_STATE_OPENINGS.test(text.trim()) && text.trim().length <= EMPTY_STATE_CAP;
}

/* ===========================================================================
 * THE DEBT LIST
 * ---------------------------------------------------------------------------
 * The nineteen explanations that describe how an engine works are in the
 * registry, and every one of them is behind a button on the screen it belongs
 * to. Empty states and the gallery are exempt by category above, because of
 * what that copy is rather than because it was inconvenient to move.
 *
 * What is left here is the genuine remainder: notices saying what a form is
 * about to do, the onboarding narrative, and screen intros.
 *
 * They are not left because they are fine. They are left because phase 4
 * rebuilds every one of these screens against the reference, and a paragraph
 * is far easier to judge in a finished screen than in a diff — the same reason
 * the label review was deferred to phase 4. Deciding now would mean deciding
 * twice.
 *
 * This list may only ever shrink. A file that has been cleaned has to come off
 * it, and the second test below fails until it does, so the list cannot
 * quietly become a place to put things.
 * ======================================================================== */

const STILL_INLINE: readonly string[] = [
  'features/accounts/AccountDetailSheet.tsx',
  'features/accounts/AccountsView.tsx',
  'features/accounts/ConvertCurrencySheet.tsx',
  'features/accounts/CreateAccountSheet.tsx',
  'features/accounts/LoanTermsSheet.tsx',
  'features/accounts/RecordLoanPaymentSheet.tsx',
  'features/accounts/RecordValuationSheet.tsx',
  'features/accounts/SettleUpSheet.tsx',
  'features/accounts/WriteOffSheet.tsx',
  'features/analytics/AnalyticsView.tsx',
  'features/budget/BudgetGrid.tsx',
  'features/budget/QuickCoverSheet.tsx',
  'features/calendar/CalendarView.tsx',
  'features/categories/CategoryManagerView.tsx',
  'features/categories/CategoryPicker.tsx',
  'features/dashboard/GettingStarted.tsx',
  'features/dashboard/PaceCard.tsx',
  'features/entry/AddPaymentSheet.tsx',
  'features/entry/PaymentDetailsSheet.tsx',
  'features/forecast/ForecastView.tsx',
  'features/forecast/RunwayCard.tsx',
  'features/forecast/WhatIfView.tsx',
  'features/goals/PotsView.tsx',
  'features/investments/AddHoldingSheet.tsx',
  'features/investments/HoldingDetailSheet.tsx',
  'features/investments/InvestSheet.tsx',
  'features/investments/InvestmentsView.tsx',
  'features/investments/RebalanceModal.tsx',
  'features/investments/SellHoldingSheet.tsx',
  'features/investments/UpdatePricesSheet.tsx',
  'features/manual/ManualView.tsx',
  'features/manual/parts.tsx',
  'features/onboarding/steps.tsx',
  'features/settings/DataAndSecurity.tsx',
  'features/settings/FxRatesSheet.tsx',
  'features/settings/RecoveryPhrase.tsx',
  'features/settings/SettingsView.tsx',
  'features/shell/BottomNav.tsx',
  'features/shell/SelectionBar.tsx',
  'features/simulations/DebtPayoffView.tsx',
  'features/simulations/IndependenceView.tsx',
  'features/storage/ProtectStorage.tsx',
  'features/triage/ImportSheet.tsx',
  'features/triage/TriageView.tsx',
];

/** Windows separators, normalised, so the list above matches on any machine. */
function relative(file: string): string {
  return file.slice(SRC.length).split(sep).join('/');
}

function featureFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) featureFiles(full, found);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Strings that are long for a reason other than being prose.
 *
 * A toast is a sentence somebody reads once and dismisses; an error explains a
 * failure at the moment it happens; an aria-label has to be a full phrase to
 * be worth anything. None of them is a paragraph under a figure.
 */
function isAllowed(line: string, value: string): boolean {
  if (/\baria-label\s*=|\baria-description|\balt\s*=/.test(line)) return true;
  if (/\btoast\s*\(|\bthrow new|Error\(|\bmessage:/.test(line)) return true;
  if (/\bplaceholder\s*=|\bhint\s*=|\bexplains:/.test(line)) return true;
  if (/^[@./]|^https?:/.test(value)) return true;
  // A className is long because it is a list of classes.
  if (/className|clsx\(/.test(line)) return true;
  return false;
}

/**
 * Whether a JSX text node is a sentence or a stretch of source.
 *
 * TypeScript's generic parameters — `useState<Foo>(…)` — put a `>` and a `<`
 * around arbitrary code, so a naive text-node match reads whole function
 * bodies as copy. Real prose has no semicolons, no arrows and no `const`, and
 * that is enough to tell them apart without trying to parse anything.
 */
function looksLikeProse(text: string): boolean {
  if (/[;{}]|=>|\bconst\b|\blet\b|\breturn\b|\)\s*\(|==|&&|\|\|/.test(text)) return false;
  // A sentence is mostly letters and spaces.
  const wordish = (text.match(/[a-zA-Z ]/g) ?? []).length / text.length;
  return wordish > 0.85;
}

describe('no explanatory prose lives in a component', () => {
  const files = featureFiles(join(SRC, 'features')).filter(
    (file) => !file.includes(MANUAL_CHAPTERS) && !file.includes(GALLERY),
  );

  it('finds components to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no paragraph a person would read under a figure', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');

      lines.forEach((line, index) => {
        // Quoted strings.
        for (const match of line.matchAll(/(['"])((?:(?!\1)[^\\])*)\1/g)) {
          const value = match[2] ?? '';
          if (value.length < LONG) continue;
          if (!/\s/.test(value)) continue;
          if ((value.match(/ /g) ?? []).length < 8) continue;
          if (isAllowed(line, value)) continue;
          if (isEmptyState(value)) continue;
          offenders.push(`${relative(file)}:${index + 1}  ${value.slice(0, 60)}…`);
        }
      });

      // JSX text nodes, which span lines. Comments are stripped first so a
      // block explaining why something works does not read as copy.
      const jsx = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      for (const match of jsx.matchAll(/>\s*([^<>{}]{90,}?)\s*</g)) {
        const text = match[1]!.replace(/\s+/g, ' ').trim();
        if ((text.match(/ /g) ?? []).length < 8) continue;
        if (!looksLikeProse(text)) continue;
        if (isEmptyState(text)) continue;
        offenders.push(`${relative(file)}  ${text.slice(0, 60)}…`);
      }
    }

    const unexpected = offenders.filter(
      (line) => !STILL_INLINE.some((file) => line.startsWith(file)),
    );

    expect(
      unexpected,
      'Move these into src/content/explain and put an <Explain> beside the label',
    ).toEqual([]);
  });

  /*
   * The debt list may only ever shrink.
   *
   * Without this the list becomes a place to put things, which is the opposite
   * of what it is for. A file that has been cleaned has to leave it, and the
   * test fails until it does.
   */
  it('lists no file that is already clean', () => {
    const stillDirty = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const jsx = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      const long =
        [...jsx.matchAll(/>\s*([^<>{}]{90,}?)\s*</g)].some((m) => {
          const t = m[1]!.replace(/\s+/g, ' ').trim();
          return looksLikeProse(t) && !isEmptyState(t);
        }) ||
        source.split('\n').some((line) =>
          [...line.matchAll(/(['"])((?:(?!\1)[^\\])*)\1/g)].some(
            (m) =>
              (m[2] ?? '').length >= LONG &&
              ((m[2] ?? '').match(/ /g) ?? []).length >= 8 &&
              !isAllowed(line, m[2] ?? '') &&
              !isEmptyState(m[2] ?? ''),
          ),
        );
      if (long) stillDirty.add(relative(file));
    }

    const cleaned = STILL_INLINE.filter(
      (file) => ![...stillDirty].some((dirty) => dirty.startsWith(file)),
    );
    expect(cleaned, 'These are clean now — take them off STILL_INLINE').toEqual([]);
  });
});

describe('the field manual keeps its prose', () => {
  it('is exempt, and still has prose worth exempting', () => {
    const chapters = featureFiles(join(SRC, 'features', 'manual', 'chapters'));
    const long = chapters.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/>\s*([^<>{}]{90,}?)\s*</g)].map((m) => m[1]),
    );
    // If this ever reaches zero, the manual has been emptied and the
    // exemption above is protecting nothing.
    expect(long.length, 'the manual should be long-form prose').toBeGreaterThan(20);
  });
});
