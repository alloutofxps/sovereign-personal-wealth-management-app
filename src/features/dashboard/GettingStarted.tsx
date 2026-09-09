/* ===========================================================================
 * WHAT A BRAND-NEW PERSON SEES
 * ---------------------------------------------------------------------------
 * Before anything is recorded there is nothing honest to say about liquidity,
 * and the safety cushion on its own would make the headline figure negative —
 * telling somebody who has done nothing wrong that they are short. So Today
 * opens with an invitation instead, and the real field appears the moment
 * there is something to base it on.
 *
 * ---------------------------------------------------------------------------
 * NO FIELD HERE, ON PURPOSE
 *
 * This is one of the screens with no hero number. There is no figure yet, and
 * promoting a zero into the slot to fill it would be showing somebody a
 * balance of nothing as though it were an answer. It opens with a headline and
 * two steps, which is what the screen is actually for.
 * ======================================================================== */

import clsx from 'clsx';
import { Button, Card } from '@/design/ui';

export function GettingStarted({
  onAdd,
  onAddBill,
  hasSchedule,
}: {
  onAdd: () => void;
  onAddBill: () => void;
  hasSchedule: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="headline text-ink">Let us get you set up</h1>

      <Card>
        <ol className="flex flex-col">
          <Step
            number={1}
            title="Tell us about a regular bill"
            done={hasSchedule}
            action={
              <Button variant={hasSchedule ? 'secondary' : 'primary'} size="sm" onClick={onAddBill}>
                {hasSchedule ? 'Add another' : 'Add a bill'}
              </Button>
            }
          >
            Rent, your phone, energy. Held back so you never spend what is promised.
          </Step>
          <Step
            number={2}
            title="Record something you spent"
            done={false}
            action={
              <Button variant="primary" size="sm" onClick={onAdd}>
                Add a payment
              </Button>
            }
          >
            Then you will see how fast the money is going, and what is left each day.
          </Step>
        </ol>
      </Card>
    </div>
  );
}

/**
 * A numbered step.
 *
 * The numbers are a genuine sequence — you cannot see a pace before there is
 * something to pace — so they earn their markers, which most numbered lists in
 * a redesign do not.
 */
function Step({
  number,
  title,
  done,
  action,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 border-b border-line-faint py-3.5 last:border-b-0">
      <span
        aria-hidden="true"
        className={clsx(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-medium',
          done
            ? 'bg-[var(--color-housing)] text-base'
            : 'border border-line-strong text-ink-3',
        )}
      >
        {done ? '✓' : number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{title}</span>
        <span className="block pt-0.5 text-caption text-ink-2">{children}</span>
        <span className="mt-2.5 block">{action}</span>
      </span>
    </li>
  );
}
