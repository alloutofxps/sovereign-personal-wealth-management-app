/* ===========================================================================
 * THE LINE YOU GOT HERE ALONG
 * ---------------------------------------------------------------------------
 * Sits directly under what somebody is worth today, because the single number
 * above it is close to useless on its own. Large or small, there is nothing to
 * do about a number. The shape of how it got there is the part that means
 * something.
 *
 * It says nothing about whether the shape is good. Somebody in their twenties
 * with €4,000 and somebody in their fifties with €400,000 both see the same
 * kind of sentence — what it did, over how long, and which round numbers it
 * passed. Software is in no position to tell either of them how they are
 * doing, and the ones that try are the ones people delete.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SENTENCES STAY
 *
 * They are not explanations of how anything works — the information button and
 * the manual own that — they are descriptions of THIS household's own line,
 * produced by the engine from its own points. Moving them behind a button
 * would hide the only reading of the chart the app offers.
 *
 * The range pills the reference draws under this chart are a phase 5 job: they
 * change what the chart plots, so they belong with the chart rather than with
 * the card around it.
 * ======================================================================== */

import { useCallback, useMemo } from 'react';
import {
  buildNetWorthHistory,
  describeMilestone,
  describeTrajectory,
  findMilestones,
  latestMilestone,
  summariseTrajectory,
} from '@/core/analytics';
import { minorUnitsPerMajor, type CurrencyCode } from '@/core/money';
import { netWorthPostings } from '@/data/repositories/ledgerRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import { useMoney } from '@/app/money/useMoney';
import { useAppConfig } from '@/app/config/store';
import { NetWorthTimeline } from '@/charts/NetWorthTimeline';
import { Card, Money, QuietTile, Tile } from '@/design/ui';

const TABLES = ['entries', 'postings', 'accounts'] as const;

export function NetWorthHistoryCard() {
  const money = useMoney();
  const locale = useAppConfig((s) => s.locale);
  const currencyCode = useAppConfig((s) => s.currencyCode);

  const query = useLiveQuery(useCallback(() => netWorthPostings(), []), TABLES);

  const view = useMemo(() => {
    const postings = query.data ?? [];
    if (postings.length === 0) return null;

    const points = buildNetWorthHistory(postings);
    if (points.length === 0) return null;

    const milestones = findMilestones(
      points,
      minorUnitsPerMajor(currencyCode as CurrencyCode),
    );

    return {
      points,
      milestones,
      summary: summariseTrajectory(points),
      latest: latestMilestone(milestones),
    };
  }, [query.data, currencyCode]);

  // 'YYYY-MM' → 'Mar 2026', in the household's own language.
  const formatMonth = useCallback(
    (month: string) => {
      const [year, m] = month.split('-').map(Number);
      return new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1, 1)).toLocaleDateString(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    },
    [locale],
  );

  const formatFullMonth = useCallback(
    (isoDate: string) => {
      const [year, m] = isoDate.split('-').map(Number);
      return new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1, 1)).toLocaleDateString(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
    },
    [locale],
  );

  if (!view) {
    return (
      <Card label="How this has moved">
        <p className="py-2 text-caption text-ink-2">
          Nothing recorded yet. A month or two from now this will show how what you are worth has
          changed.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card label="How this has moved">
        <div className="flex flex-col gap-3">
          <NetWorthTimeline
            points={view.points}
            milestones={view.milestones}
            format={money.format}
            formatMonth={formatMonth}
          />

          <p className="text-caption leading-relaxed text-ink-2">
            {describeTrajectory(view.summary, money.format)}
          </p>
        </div>
      </Card>

      {/*
        * The reference's pair of tiles under the line: a landmark reached, and
        * the rate the line has actually been travelling at. Health carries the
        * landmark because it is a thing at rest — a mark passed, not a mark to
        * aim for — and the rate takes the quiet tile, because "the average
        * month" belongs to no category.
        */}
      {(view.latest ?? view.summary) && (
        <div className="grid grid-cols-2 gap-3">
          {view.latest && (
            <Tile family="health">
              <div className="text-caption opacity-75">Crossed</div>
              <div className="pt-2">
                <Money value={view.latest.amount} size="figure" tone="neutral" decimals="hide" />
              </div>
              <div className="truncate pt-1.5 text-caption opacity-70">
                {view.latest.reachedMonth ? formatFullMonth(view.latest.reachedMonth) : ''}
              </div>
            </Tile>
          )}

          {view.summary && (
            <QuietTile>
              <div className="text-caption opacity-75">A month, on average</div>
              <div className="pt-2">
                <Money
                  value={view.summary.averageMonthlyChange}
                  size="figure"
                  tone={view.summary.averageMonthlyChange < 0 ? 'deficit' : 'neutral'}
                  decimals="hide"
                  signDisplay="always"
                />
              </div>
              <div className="pt-1.5 text-caption opacity-70">
                over {view.points.length} {view.points.length === 1 ? 'month' : 'months'}
              </div>
            </QuietTile>
          )}
        </div>
      )}

      {view.latest && (
        <p className="text-caption text-ink-3">
          {describeMilestone(view.latest, money.format, formatFullMonth)}
        </p>
      )}
    </div>
  );
}
