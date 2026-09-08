/* ===========================================================================
 * LOOKING AHEAD
 * ---------------------------------------------------------------------------
 * Three views of the same future, behind one toggle: the shape of the balance,
 * the days things land on, and what it would take to be free of the debt.
 *
 * They were three separate destinations reached through buttons at the bottom
 * of the first one, which meant most people never found the other two. A
 * segmented control says outright that they exist.
 * ======================================================================== */

import { Suspense, lazy, useEffect } from 'react';
import { isAheadRoute, useRoute, type Route } from '@/app/router';
import { Tabs } from '@/design/ui';
import { CalendarView } from '@/features/calendar/CalendarView';
import { SubscriptionAudit } from '@/features/calendar/SubscriptionAudit';
import { DebtPayoffView } from '@/features/simulations/DebtPayoffView';
import { ForecastView } from './ForecastView';

/**
 * The analytics pane is lazy even from here.
 *
 * It was a plain import, which put the Sankey geometry, the ranking maths and
 * the trailing-median engine into this chunk — so opening the forecast
 * downloaded all of it for somebody who never touched the analytics tab. First
 * paint was unaffected, which is exactly what made it easy to miss.
 */
const AnalyticsView = lazy(() =>
  import('@/features/analytics/AnalyticsView').then((m) => ({ default: m.AnalyticsView })),
);

// Lazy for the same reason: the what-if pane carries the branch tables, the
// branching engine and a second projection, and nobody reaches it by accident.
const WhatIfView = lazy(() =>
  import('./WhatIfView').then((m) => ({ default: m.WhatIfView })),
);

type Pane = 'forecast' | 'calendar' | 'analytics' | 'debt' | 'whatif';

const ROUTE_FOR: Record<Pane, Route> = {
  forecast: 'forecast',
  calendar: 'calendar',
  analytics: 'analytics',
  debt: 'debt',
  whatif: 'whatif',
};

/**
 * Which pane this route is showing.
 *
 * Each pane keeps its own URL, so a link to the calendar still opens the
 * calendar and the back button steps between them the way it should.
 */
function paneFor(route: Route): Pane {
  if (route === 'calendar') return 'calendar';
  if (route === 'analytics') return 'analytics';
  if (route === 'debt') return 'debt';
  if (route === 'whatif') return 'whatif';
  return 'forecast';
}

export function AheadView() {
  const [route, navigate] = useRoute();
  const pane = paneFor(route);

  // Keep the document in step when somebody arrives on a bare route.
  useEffect(() => {
    if (!isAheadRoute(route)) navigate('forecast');
  }, [route, navigate]);

  return (
    <div className="flex flex-col gap-5">
      <Tabs
        label="What to look at"
        value={pane}
        onChange={(next) => navigate(ROUTE_FOR[next])}
        tabs={[
          { value: 'forecast', label: 'Forecast' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'analytics', label: 'Where it went' },
          { value: 'debt', label: 'Payoff' },
          { value: 'whatif', label: 'What if' },
        ]}
      />

      {pane === 'calendar' && <SubscriptionAudit />}

      {pane === 'forecast' ? (
        <ForecastView />
      ) : pane === 'calendar' ? (
        <CalendarView />
      ) : pane === 'analytics' ? (
        <Suspense fallback={<div className="min-h-[50dvh]" aria-hidden="true" />}>
          <AnalyticsView />
        </Suspense>
      ) : pane === 'debt' ? (
        <DebtPayoffView />
      ) : (
        <Suspense fallback={<div className="min-h-[50dvh]" aria-hidden="true" />}>
          <WhatIfView />
        </Suspense>
      )}
    </div>
  );
}
