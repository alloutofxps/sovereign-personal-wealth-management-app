/* Layer 2 — opening up the headline figure.
 *
 * The number is only trustworthy if a person can see exactly what went into
 * it. Every line here is a real subtraction from the calculation, named in
 * words the person would use, and the arithmetic is shown adding up. */

import type { Minor } from '@/core/money';
import type { DashboardData } from '@/app/dashboard/useDashboard';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { BottomSheet, Money } from '@/design/ui';
import { ManualLink } from '@/features/manual/ManualLink';

export function SafeToSpendSheet({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: DashboardData | undefined;
}) {
  const locale = useAppConfig((s) => s.locale);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="How this figure is worked out"
      description="Everything below is taken off what is in your accounts today."
      size="tall"
    >
      {!data ? (
        <p className="text-body text-ink-2">Working it out…</p>
      ) : (
        <div className="flex flex-col gap-1 pb-4">
          <Row
            label="In your everyday accounts and savings"
            value={data.liquidity.liquidCash}
            tone="positive"
          />

          {data.liquidity.breakdown.length === 0 ? (
            <p className="px-1 py-3 text-caption text-ink-2">
              Nothing is taken off at the moment. Once you tell Sovereign about your regular
              bills, they will be held back here so you never spend money that is already
              promised.
            </p>
          ) : (
            data.liquidity.breakdown.map((item, index) => (
              <Row
                key={`${item.label}-${index}`}
                label={item.label}
                detail={
                  item.dueDate
                    ? `due ${describeDate(item.dueDate, locale).toLowerCase()}`
                    : item.kind === 'card'
                      ? 'what you owe on it right now'
                      : item.kind === 'buffer'
                        ? 'never counted as spendable, so a surprise cannot overdraw you'
                        : 'already promised to something else'
                }
                value={item.amount}
                tone="negative"
              />
            ))
          )}

          <div className="mt-3 flex items-baseline justify-between gap-4 border-t-2 border-line-strong pt-3">
            <span className="text-body font-medium text-ink">Left to spend</span>
            <Money
              value={data.liquidity.safeToSpend}
              size="figure"
              tone={data.liquidity.safeToSpend < 0 ? 'deficit' : 'liquid'}
            />
          </div>

          <p className="pt-3 text-caption text-ink-2">
            {data.liquidity.dailyPace > 0
              ? `Spread over the next ${data.liquidity.paceDays} days, that is about ` +
                `the daily amount on your home screen. Spend more one day and it quietly ` +
                `adjusts the next — nothing is failed or blown.`
              : `There is nothing spare right now. Nothing has gone wrong: it just means every ` +
                `penny in your accounts is already spoken for by something on this list.`}
          </p>

          <div className="flex pt-3">
            <ManualLink chapter="safe-to-spend">Read how this figure is worked out</ManualLink>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function Row({
  label,
  detail,
  value,
  tone,
}: {
  label: string;
  detail?: string;
  value: Minor;
  tone: 'positive' | 'negative';
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-faint py-3">
      <div className="min-w-0">
        <p className="text-body text-ink">{label}</p>
        {detail && <p className="pt-0.5 text-caption text-ink-3">{detail}</p>}
      </div>
      <div className="shrink-0 pt-0.5">
        {tone === 'negative' ? (
          <span className="tnum text-body text-ink-2">
            −<Money value={value} size="body" tone="muted" />
          </span>
        ) : (
          <Money value={value} size="body" />
        )}
      </div>
    </div>
  );
}
