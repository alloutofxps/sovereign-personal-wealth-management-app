/* What a brand-new person sees.
 *
 * Before anything is recorded there is nothing honest to say about liquidity,
 * and the safety cushion on its own would make the headline figure negative —
 * telling someone who has done nothing wrong that they are short. So the
 * dashboard opens with an invitation instead, and the real figures appear as
 * soon as there is something to base them on. */

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
    <Card accent="liquid">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lead font-medium text-ink">Let us get you set up</h2>
          <p className="max-w-[42ch] text-caption text-ink-2">
            Sovereign works out what is genuinely safe to spend by taking your bills and a small
            safety cushion off what you actually have. Two short steps and it can start.
          </p>
        </div>

        <ol className="flex flex-col gap-3">
          <Step
            number={1}
            title="Tell us about a regular bill"
            body="Rent, your phone, energy. Anything that goes out on its own. These are held back so you never spend money that is already promised."
            done={hasSchedule}
            action={
              <Button variant={hasSchedule ? 'secondary' : 'primary'} size="sm" onClick={onAddBill}>
                {hasSchedule ? 'Add another' : 'Add a bill'}
              </Button>
            }
          />
          <Step
            number={2}
            title="Record something you spent"
            body="Once there is a little activity, you will see how fast your money is going and what is left for each day."
            done={false}
            action={
              <Button variant="primary" size="sm" onClick={onAdd}>
                Add a payment
              </Button>
            }
          />
        </ol>
      </div>
    </Card>
  );
}

function Step({
  number,
  title,
  body,
  done,
  action,
}: {
  number: number;
  title: string;
  body: string;
  done: boolean;
  action: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={
          done
            ? 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-liquid text-base'
            : 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-micro text-ink-3'
        }
        aria-hidden="true"
      >
        {done ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path
              d="m4 12.5 5 5L20 6.5"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          number
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-body text-ink">{title}</p>
        <p className="max-w-[40ch] text-caption text-ink-2">{body}</p>
        <div className="pt-0.5">{action}</div>
      </div>
    </li>
  );
}
