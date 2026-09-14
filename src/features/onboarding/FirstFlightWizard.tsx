/* ===========================================================================
 * FIRST FLIGHT
 * ---------------------------------------------------------------------------
 * The first five minutes, which decide whether there is a sixth.
 *
 * A budgeting app's opening move is usually a wall: connect a bank, make an
 * account, agree to something. Sovereign cannot do the first two and will not
 * do the third, which leaves the honest version — ask for the handful of facts
 * that make the home screen mean anything, and get out of the way.
 *
 * Three rules hold the whole thing together:
 *
 *   · Every step writes as it goes. Nothing waits for a finish button, so
 *     abandoning halfway keeps everything entered so far.
 *   · Every step can be skipped, including the first. A person who wants to
 *     look around first is not doing it wrong.
 *   · Closing it counts as an answer. "Not now" is a decision, and asking
 *     again next launch would be nagging — Settings has a way back in.
 *
 * It is shown once, to a database that has never finished it. A restored
 * export has, because the fact travels in `meta` with everything else.
 * ======================================================================== */

import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { markOnboardingComplete } from '@/data/repositories/onboardingRepo';
import { Button } from '@/design/ui';
import {
  StepPromise,
  StepRegulars,
  StepSaving,
  StepTheNumber,
  StepWhatYouOwe,
  StepWhereItIs,
  type Added,
} from './steps';

/**
 * The six steps, in the order the questions actually depend on each other:
 * what you have, then what you owe against it, then what moves in and out of
 * it, then what you are holding back from it, and only then the figure that
 * comes out of all four.
 */
const STEPS = ['promise', 'cash', 'debts', 'regulars', 'pots', 'number'] as const;
type Step = (typeof STEPS)[number];

/** The word on the button that moves on, per step. */
const ONWARD: Record<Step, string> = {
  promise: 'Start',
  cash: 'Next',
  debts: 'Next',
  regulars: 'Next',
  pots: 'Next',
  number: 'Take me in',
};

export function FirstFlightWizard({ onFinished }: { onFinished: () => void }) {
  const [index, setIndex] = useState(0);
  const [cash, setCash] = useState<Added[]>([]);
  const [debts, setDebts] = useState<Added[]>([]);
  const [regulars, setRegulars] = useState<Added[]>([]);
  const [pots, setPots] = useState<Added[]>([]);
  const [leaving, setLeaving] = useState(false);

  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  /**
   * Finish, whether that was by working through it or by closing it.
   *
   * Both write the same fact, because both are the same answer to "has this
   * person been asked?". A failure to record it is not worth blocking anybody
   * over — the worst case is being offered the wizard once more.
   */
  const finish = useCallback(async () => {
    setLeaving(true);
    try {
      await markOnboardingComplete();
    } finally {
      onFinished();
    }
  }, [onFinished]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base" role="dialog" aria-modal="true">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-[calc(0.75rem+var(--safe-top))]">
        <Progress index={index} total={STEPS.length} />
        <button
          type="button"
          onClick={() => void finish()}
          disabled={leaving}
          className="shrink-0 rounded-md px-2 py-1 text-caption text-ink-3 [@media(hover:hover)]:hover:text-ink-2"
        >
          {last ? 'Close' : 'Not now'}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-[34rem]">
          {step === 'promise' && <StepPromise />}
          {step === 'cash' && (
            <StepWhereItIs
              added={cash}
              onAdded={(item) => setCash((previous) => [...previous, item])}
            />
          )}
          {step === 'debts' && (
            <StepWhatYouOwe
              added={debts}
              onAdded={(item) => setDebts((previous) => [...previous, item])}
            />
          )}
          {step === 'regulars' && (
            <StepRegulars
              added={regulars}
              onAdded={(item) => setRegulars((previous) => [...previous, item])}
            />
          )}
          {step === 'pots' && (
            <StepSaving
              added={pots}
              onAdded={(item) => setPots((previous) => [...previous, item])}
            />
          )}
          {step === 'number' && <StepTheNumber />}
        </div>
      </main>

      <footer className="shrink-0 border-t border-line-faint bg-surface px-4 pb-[calc(1rem+var(--safe-bottom))] pt-4">
        <div className="mx-auto flex w-full max-w-[34rem] gap-2">
          {index > 0 && (
            <Button variant="secondary" onClick={() => setIndex((i) => i - 1)}>
              Back
            </Button>
          )}
          <Button
            variant="primary"
            block
            disabled={leaving}
            onClick={() => (last ? void finish() : setIndex((i) => i + 1))}
          >
            {ONWARD[step]}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/**
 * How far along this is.
 *
 * Segments rather than a percentage: six is a number a person can hold, and
 * "17%" on the first screen of a setup reads as a longer job than it is.
 */
function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div
      className="flex flex-1 items-center gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-label={`Step ${index + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, position) => (
        <span
          key={position}
          className={clsx(
            'h-1 flex-1 rounded-pill transition-colors',
            position <= index ? 'bg-liquid' : 'bg-line',
          )}
        />
      ))}
    </div>
  );
}
