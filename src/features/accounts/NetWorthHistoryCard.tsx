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
import { Card } from '@/design/ui';

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

  // 'YYYY-MM' → 'March 2026', in the household's own language.
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
          There is nothing recorded yet. Once there is a month or two behind you, this will show
          how what you are worth has changed.
        </p>
      </Card>
    );
  }

  return (
    <Card label="How this has moved">
      <div className="flex flex-col gap-3">
        <NetWorthTimeline
          points={view.points}
          milestones={view.milestones}
          format={money.format}
          formatMonth={formatMonth}
        />

        <p className="text-caption text-ink-2">
          {describeTrajectory(view.summary, money.format)}
        </p>

        {view.latest && (
          <p className="text-caption text-ink-3">
            {describeMilestone(view.latest, money.format, formatFullMonth)}
          </p>
        )}
      </div>
    </Card>
  );
}
