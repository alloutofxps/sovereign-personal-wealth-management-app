/* ===========================================================================
 * HOW THE BUDGET IS SHAPED
 * ---------------------------------------------------------------------------
 * Two choices that change what every period means, so both are explained in
 * terms of what will happen rather than in terms of what they are called.
 *
 * They live in the ledger rather than in browser storage on purpose: switching
 * to "carry the negative" changes what every past month adds up to, and an
 * export restored on a new phone without that setting would quietly rewrite
 * history.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import { CADENCE_DESCRIPTIONS, toIsoDate, type BudgetCadence } from '@/core/liquidity';
import type { OverspendPolicy } from '@/core/budget';
import {
  BUDGET_TABLES,
  DEFAULT_BUDGET_SETTINGS,
  readBudgetSettings,
  writeBudgetSettings,
  type BudgetSettings,
} from '@/data/repositories/budgetRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { toast } from '@/app/toast';
import { Card, Input, Select } from '@/design/ui';

const CADENCE_OPTIONS: { value: BudgetCadence; label: string }[] = [
  { value: 'calendar_month', label: 'Calendar months' },
  { value: 'weekly', label: 'Every week, from payday' },
  { value: 'biweekly', label: 'Every two weeks, from payday' },
  { value: 'semimonthly', label: 'Twice a month, from payday' },
];

const POLICY_OPTIONS: { value: OverspendPolicy; label: string }[] = [
  { value: 'deduct_next_rta', label: 'Take it out of next period' },
  { value: 'carry_negative', label: 'Leave it against that pot' },
];

export function BudgetSettingsCard() {
  const settings = useLiveQuery(
    useCallback(() => readBudgetSettings().catch(() => DEFAULT_BUDGET_SETTINGS), []),
    BUDGET_TABLES,
  );

  const current = settings.data ?? DEFAULT_BUDGET_SETTINGS;
  const [anchor, setAnchor] = useState(current.paycheckAnchor ?? toIsoDate(new Date()));

  useEffect(() => {
    if (current.paycheckAnchor) setAnchor(current.paycheckAnchor);
  }, [current.paycheckAnchor]);

  async function save(patch: Partial<BudgetSettings>, said: string) {
    try {
      await writeBudgetSettings(patch);
      toast(said);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be saved.', {
        tone: 'attention',
      });
    }
  }

  const onPaycheckCadence = current.cadence !== 'calendar_month';

  return (
    <Card label="How your budget is divided up">
      <div className="flex flex-col gap-4">
        <Select
          label="Periods run"
          value={current.cadence}
          onChange={(e) => {
            const cadence = e.target.value as BudgetCadence;
            void save(
              {
                cadence,
                // A pay cycle needs a day to count from; without one every
                // period boundary would be a guess.
                paycheckAnchor: cadence === 'calendar_month' ? null : anchor,
              },
              cadence === 'calendar_month'
                ? 'Your budget now runs in calendar months.'
                : 'Your budget now runs from the day you are paid.',
            );
          }}
          options={CADENCE_OPTIONS}
          hint={CADENCE_DESCRIPTIONS[current.cadence]}
        />

        {onPaycheckCadence && (
          <Input
            type="date"
            label="A day you were paid"
            value={anchor}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              setAnchor(value);
              void save({ paycheckAnchor: value }, 'Your pay cycles start from that day.');
            }}
            hint="Every period is counted from this day, so it only has to be right once."
          />
        )}

        <Select
          label="When a pot goes over"
          value={current.overspendPolicy}
          onChange={(e) =>
            void save(
              { overspendPolicy: e.target.value as OverspendPolicy },
              e.target.value === 'carry_negative'
                ? 'Overspending will stay against the pot it happened in.'
                : 'Overspending will come out of the next period instead.',
            )
          }
          options={POLICY_OPTIONS}
          hint={
            current.overspendPolicy === 'carry_negative'
              ? 'The pot starts the next period still in the red, and has to be filled ' +
                'before it is healthy again. Keeps the story with the category.'
              : 'The pot starts fresh and the shortfall comes off what you have to assign ' +
                'next period. Keeps each period honest about what is left.'
          }
        />
      </div>
    </Card>
  );
}
