/* ===========================================================================
 * THE BUDGET, PERIOD BY PERIOD
 * ---------------------------------------------------------------------------
 * Reads the whole run of periods up to the one being looked at, hands them to
 * the pure planner, and joins the result back to envelope names and groups.
 *
 * Every period from the first record onwards is walked, not just the one on
 * screen. Balances carry forward, so the only way September's figures can be
 * right is to have got every month before it right too.
 * ======================================================================== */

import { useCallback, useMemo, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import {
  cycleKey,
  monthCycle,
  paycheckCycle,
  shiftCycle,
  toIsoDate,
  type Cycle,
} from '@/core/liquidity';
import { planBudget, type BudgetPlan, type PeriodInput } from '@/core/budget';
import { useLiveQuery, type LiveQueryResult } from '@/data/live/useLiveQuery';
import { spendableCash } from '@/data/repositories/ledgerRepo';
import {
  BUDGET_TABLES,
  DEFAULT_BUDGET_SETTINGS,
  assignedAfter,
  listBudgetEnvelopes,
  movementsByPeriod,
  readBudgetSettings,
  type BudgetSettings,
  type EnvelopeRow,
} from '@/data/repositories/budgetRepo';

export interface BudgetRow extends EnvelopeRow {
  assigned: Minor;
  activity: Minor;
  available: Minor;
  broughtForward: Minor;
  overspent: boolean;
}

export interface BudgetGroup {
  groupId: string;
  groupName: string;
  rows: BudgetRow[];
  assigned: Minor;
  activity: Minor;
  available: Minor;
}

export interface BudgetView {
  settings: BudgetSettings;
  cycle: Cycle;
  periodKey: string;
  plan: BudgetPlan;
  groups: BudgetGroup[];
  ungrouped: BudgetRow[];
  rows: BudgetRow[];
  /** True when nothing has ever been recorded. */
  empty: boolean;
}

/** The cycle containing a date, under the person's chosen cadence. */
export function cycleFor(settings: BudgetSettings, date: string): Cycle {
  if (settings.cadence === 'calendar_month' || !settings.paycheckAnchor) {
    return monthCycle(date);
  }
  return paycheckCycle(settings.paycheckAnchor, settings.cadence, date);
}

async function load(offset: number): Promise<BudgetView> {
  const settings = await readBudgetSettings().catch(() => DEFAULT_BUDGET_SETTINGS);
  const today = toIsoDate(new Date());

  const base = cycleFor(settings, today);
  const cycle =
    offset === 0
      ? base
      : shiftCycle(base, settings.cadence, settings.paycheckAnchor ?? base.start, offset);

  const keyOf = (date: string) => cycleKey(cycleFor(settings, date), settings.cadence);
  const periodKey = cycleKey(cycle, settings.cadence);

  const [envelopes, movements, cash, future] = await Promise.all([
    listBudgetEnvelopes(),
    movementsByPeriod(cycle.end, keyOf),
    spendableCash(),
    assignedAfter(cycle.end),
  ]);

  // Every period from the first movement to the one on screen, in order, with
  // the empty ones included: a gap would break the carry-forward chain and
  // make a later month's opening balance wrong.
  const keys = [...movements.keys()].sort();
  const periods: PeriodInput[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    seen.add(key);
    periods.push({ key, envelopes: movements.get(key) ?? [] });
  }
  if (!seen.has(periodKey)) periods.push({ key: periodKey, envelopes: [] });

  const plan = planBudget({
    periods,
    liquidCash: cash,
    assignedToFuture: future,
    policy: settings.overspendPolicy,
  });

  const stateById = new Map(plan.current.envelopes.map((e) => [e.envelopeId, e]));

  const rows: BudgetRow[] = envelopes.map((envelope) => {
    const state = stateById.get(envelope.envelopeId);
    return {
      ...envelope,
      assigned: state?.assigned ?? minor(0),
      activity: state?.activity ?? minor(0),
      available: state?.available ?? minor(0),
      broughtForward: state?.broughtForward ?? minor(0),
      overspent: (state?.available ?? 0) < 0,
    };
  });

  const byGroup = new Map<string, BudgetGroup>();
  const ungrouped: BudgetRow[] = [];

  for (const row of rows) {
    if (!row.groupId) {
      ungrouped.push(row);
      continue;
    }
    const group =
      byGroup.get(row.groupId) ??
      ({
        groupId: row.groupId,
        groupName: row.groupName ?? 'Other',
        rows: [],
        assigned: minor(0),
        activity: minor(0),
        available: minor(0),
      } satisfies BudgetGroup);

    group.rows.push(row);
    // A group is exactly the sum of what is under it, never its own figure.
    group.assigned = minor(group.assigned + row.assigned);
    group.activity = minor(group.activity + row.activity);
    group.available = minor(group.available + row.available);
    byGroup.set(row.groupId, group);
  }

  return {
    settings,
    cycle,
    periodKey,
    plan,
    groups: [...byGroup.values()],
    ungrouped,
    rows,
    empty: movements.size === 0 && cash === 0,
  };
}

/** The grid's data, for a period `offset` cycles from the current one. */
export function useBudget(offset: number): LiveQueryResult<BudgetView> {
  const run = useCallback(() => load(offset), [offset]);
  return useLiveQuery(run, BUDGET_TABLES);
}

/** Which period the grid is showing, and how to step through them. */
export function useBudgetPeriod() {
  const [offset, setOffset] = useState(0);
  return useMemo(
    () => ({
      offset,
      next: () => setOffset((n) => n + 1),
      previous: () => setOffset((n) => n - 1),
      backToNow: () => setOffset(0),
      isCurrent: offset === 0,
    }),
    [offset],
  );
}

/** A date inside a cycle, for dating an assignment into it. */
export function dateInsideCycle(cycle: Cycle, today: string): string {
  if (today >= cycle.start && today <= cycle.end) return today;
  return cycle.start;
}

export type { AccountId };
