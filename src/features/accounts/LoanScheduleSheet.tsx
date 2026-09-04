/* ===========================================================================
 * WHAT YOUR LOAN PAYMENT IS ACTUALLY DOING
 * ---------------------------------------------------------------------------
 * The split comes first, before the schedule, before the chart, before
 * anything else. On a €200,000 mortgage at 4%, €666.67 of the first €954.83
 * payment is interest and €288.16 buys a piece of the house — and almost
 * nobody paying that mortgage knows it. Everything else on this sheet is
 * context for that one line.
 *
 * The overpayment slider says what a bit more each month would do, and then
 * stops. Whether somebody should overpay a 4% mortgage or invest the same
 * money depends on their tax position, their other debts, their job security
 * and how they sleep at night. This app knows none of that, so it states the
 * arithmetic and lets the person decide.
 *
 * The schedule is the full remaining term, scrolled rather than paginated —
 * three hundred rows is the honest answer to "how long is this", and hiding
 * them behind pages makes it feel shorter than it is.
 * ======================================================================== */

import { useCallback, useMemo, useState } from 'react';
import { minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import {
  calculateEarlyPayoff,
  calculateNextLoanSplit,
  describeMonths,
  describePayoff,
  describeProgress,
  describeSplit,
  generateAmortizationSchedule,
  totalsOf,
} from '@/core/debt/amortization';
import { LOAN_TABLES, getLoan, paidToDate, termsOf } from '@/data/repositories/loansRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { useMoney } from '@/app/money/useMoney';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { BottomSheet, Button, Card, StatPill } from '@/design/ui';
import { LoanTermsSheet } from './LoanTermsSheet';

/** The steps on the overpayment slider, in whole units of currency. */
const EXTRA_STEPS = [0, 25, 50, 100, 200, 350, 500, 1000];

export function LoanScheduleSheet({
  accountId,
  onClose,
  onRecordPayment,
}: {
  accountId: AccountId | null;
  onClose: () => void;
  onRecordPayment?: (accountId: AccountId) => void;
}) {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const [extraStep, setExtraStep] = useState(0);
  const [editingTerms, setEditingTerms] = useState(false);

  const loan = useLiveQuery(
    useCallback(() => (accountId ? getLoan(accountId) : Promise.resolve(null)), [accountId]),
    LOAN_TABLES,
  );
  const paid = useLiveQuery(
    useCallback(
      () =>
        accountId
          ? paidToDate(accountId)
          : Promise.resolve({ principal: minor(0), interest: minor(0), escrow: minor(0), payments: 0 }),
      [accountId],
    ),
    LOAN_TABLES,
  );

  const data = loan.data ?? null;
  const extra = minor(EXTRA_STEPS[extraStep]! * 100);

  const view = useMemo(() => {
    if (!data || !data.hasTerms || data.balance <= 0) return null;
    const terms = termsOf(data);
    try {
      const rows = generateAmortizationSchedule(terms);
      return {
        split: calculateNextLoanSplit(terms),
        rows,
        totals: totalsOf(rows),
        payoff: calculateEarlyPayoff(terms, extra),
      };
    } catch {
      // A payment that cannot cover the interest. The sheet says so below
      // rather than showing a wall of rows that never reach zero.
      return null;
    }
  }, [data, extra]);

  const title = data ? data.account.name : 'Your loan';

  return (
    <BottomSheet
      open={accountId !== null}
      onClose={onClose}
      size="tall"
      title={title}
      description="What each payment is really made of, and where this ends."
      footer={
        data && data.balance > 0 && onRecordPayment ? (
          <Button variant="primary" block onClick={() => onRecordPayment(data.account.id)}>
            Record a payment
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {!data ? (
          <p className="py-2 text-caption text-ink-2">Loading what you owe…</p>
        ) : data.balance <= 0 ? (
          <Card>
            <p className="text-caption text-ink">
              {data.account.name} is paid off. There is nothing left owing on it.
            </p>
          </Card>
        ) : !data.hasTerms || !view ? (
          <Card>
            <div className="flex flex-col items-start gap-3">
              <p className="text-caption text-ink-2">
                {money.format(data.balance)} is still owed on {data.account.name}. To show what
                each payment is made of, this needs the monthly payment and the interest rate from
                your loan agreement.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setEditingTerms(true)}>
                Add the terms
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* --- the split: the reason this sheet exists ------------- */}
            <div className="flex flex-col gap-2 rounded-md border border-line bg-raised px-3.5 py-3">
              <div className="flex flex-wrap gap-2">
                <StatPill
                  label="Builds your equity"
                  value={money.format(view.split.principal)}
                  tone="liquid"
                />
                <StatPill
                  label="Interest"
                  value={money.format(view.split.interest)}
                  tone="caution"
                />
                {view.split.escrow > 0 && (
                  <StatPill label="Tax and insurance" value={money.format(view.split.escrow)} />
                )}
              </div>
              <p className="text-caption text-ink-2">
                {describeSplit(view.split, money.format)}
              </p>
            </div>

            {/* --- how far through ------------------------------------- */}
            <Card>
              <div className="flex flex-col gap-1.5">
                <p className="text-caption text-ink">
                  {money.format(data.balance)} still owed
                  {data.originalPrincipal
                    ? ` of the ${money.format(data.originalPrincipal)} borrowed`
                    : ''}
                  .
                </p>
                <p className="text-caption text-ink-3">
                  {describeProgress({
                    paymentsMade: data.paymentsMade,
                    termMonths: data.termMonths,
                  })}
                </p>
                {paid.data && paid.data.payments > 0 && (
                  <p className="text-caption text-ink-3">
                    Of everything you have paid so far, {money.format(paid.data.principal)} came off
                    what you owe and {money.format(paid.data.interest)} was interest.
                  </p>
                )}
              </div>
            </Card>

            {/* --- where this ends ------------------------------------- */}
            <Card>
              <div className="flex flex-col gap-1.5">
                <p className="text-caption text-ink">
                  At this rate it is paid off in {describeMonths(view.totals.months)}
                  {view.totals.payoffDate
                    ? `, on ${describeDate(view.totals.payoffDate, locale)}`
                    : ''}
                  .
                </p>
                <p className="text-caption text-ink-2">
                  Between now and then, {money.format(view.totals.totalInterest)} of what you pay is
                  interest.
                </p>
              </div>
            </Card>

            {/* --- what paying more would do --------------------------- */}
            <div className="flex flex-col gap-2.5 rounded-md border border-line bg-raised px-3.5 py-3">
              <label htmlFor="extra-principal" className="text-caption text-ink">
                Paying extra each month
              </label>
              <input
                id="extra-principal"
                type="range"
                min={0}
                max={EXTRA_STEPS.length - 1}
                step={1}
                value={extraStep}
                onChange={(e) => setExtraStep(Number(e.target.value))}
                className="w-full accent-[var(--color-liquid)]"
                aria-valuetext={money.format(extra)}
              />
              <div className="flex items-baseline justify-between">
                <span className="tnum text-caption text-ink">{money.format(extra)} a month</span>
                {view.payoff.monthsSaved > 0 && (
                  <span className="tnum text-caption text-liquid">
                    {describeMonths(view.payoff.monthsSaved)} sooner
                  </span>
                )}
              </div>
              <p className="text-caption text-ink-2">
                {describePayoff(view.payoff, money.format)}
              </p>
            </div>

            <button
              type="button"
              className="self-start text-caption text-ink-3 underline underline-offset-2"
              onClick={() => setEditingTerms(true)}
            >
              Change the terms of this loan
            </button>

            {/* --- the whole schedule ---------------------------------- */}
            <details className="rounded-md border border-line bg-raised px-3.5 py-3">
              <summary className="cursor-pointer text-caption text-ink">
                Every payment from here ({view.rows.length})
              </summary>
              <div className="mt-3 max-h-80 overflow-y-auto">
                <table className="w-full border-collapse text-micro">
                  <thead className="sticky top-0 bg-raised">
                    <tr className="text-left text-ink-3">
                      <th className="py-1 pr-2 font-normal">When</th>
                      <th className="py-1 pr-2 text-right font-normal">Equity</th>
                      <th className="py-1 pr-2 text-right font-normal">Interest</th>
                      <th className="py-1 text-right font-normal">Left owing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((row) => (
                      <tr key={row.paymentNumber} className="border-t border-line-faint">
                        <td className="py-1 pr-2 text-ink-3">
                          {row.date ? row.date.slice(0, 7) : `#${row.paymentNumber}`}
                        </td>
                        <td className="tnum py-1 pr-2 text-right text-ink">
                          {money.amountOnly(row.principal)}
                        </td>
                        <td className="tnum py-1 pr-2 text-right text-ink-3">
                          {money.amountOnly(row.interest)}
                        </td>
                        <td className="tnum py-1 text-right text-ink-2">
                          {money.amountOnly(row.remainingBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </div>

      <LoanTermsSheet loan={editingTerms ? data : null} onClose={() => setEditingTerms(false)} />
    </BottomSheet>
  );
}
