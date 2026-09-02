/* Tier 4 — what needs a decision from you, and what is about to leave. */

import type { DashboardData } from '@/app/dashboard/useDashboard';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { Money, StatPill } from '@/design/ui';

export function TriageBar({
  data,
  unreviewed,
  onOpenReview,
  onAddBill,
}: {
  data: DashboardData;
  unreviewed: number;
  onOpenReview: () => void;
  onAddBill: () => void;
}) {
  const locale = useAppConfig((s) => s.locale);
  const soon = data.dueSoon;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">
        Anything needing you
      </h2>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onOpenReview} className="text-left">
          <StatPill
            label="To review"
            value={unreviewed === 0 ? 'All done' : String(unreviewed)}
            detail={
              unreviewed === 0
                ? 'You are all caught up'
                : `${unreviewed === 1 ? 'payment is' : 'payments are'} waiting for a quick look`
            }
            tone={unreviewed === 0 ? 'liquid' : 'caution'}
            dot={unreviewed > 0}
          />
        </button>

        {soon.length === 0 ? (
          <button type="button" onClick={onAddBill} className="text-left">
            <StatPill
              label="Bills due soon"
              value={data.hasSchedule ? 'Nothing' : 'Add yours'}
              detail={
                data.hasSchedule
                  ? 'Nothing is due in the next three days'
                  : 'Tell Sovereign about your regular bills so they are held back for you'
              }
            />
          </button>
        ) : (
          <StatPill
            label="Bills due soon"
            value={<Money value={sum(soon)} size="lead" tone="caution" decimals="hide" />}
            detail={
              soon.length === 1
                ? `${soon[0]!.name}, ${describeDate(soon[0]!.date, locale).toLowerCase()}`
                : `${soon.length} payments in the next three days`
            }
            tone="caution"
            dot
          />
        )}
      </div>
    </section>
  );
}

function sum(bills: DashboardData['dueSoon']) {
  return bills.reduce((total, bill) => total + bill.amount, 0) as DashboardData['liquidCash'];
}
