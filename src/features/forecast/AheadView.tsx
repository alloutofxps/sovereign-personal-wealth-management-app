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

import { useEffect } from 'react';
import { useRoute, type Route } from '@/app/router';
import { Tabs } from '@/design/ui';
import { CalendarView } from '@/features/calendar/CalendarView';
import { SubscriptionAudit } from '@/features/calendar/SubscriptionAudit';
import { DebtPayoffView } from '@/features/simulations/DebtPayoffView';
import { ForecastView } from './ForecastView';

type Pane = 'forecast' | 'calendar' | 'debt';

const ROUTE_FOR: Record<Pane, Route> = {
  forecast: 'forecast',
  calendar: 'calendar',
  debt: 'debt',
};

/**
 * Which pane this route is showing.
 *
 * Each pane keeps its own URL, so a link to the calendar still opens the
 * calendar and the back button steps between them the way it should.
 */
function paneFor(route: Route): Pane {
  if (route === 'calendar') return 'calendar';
  if (route === 'debt') return 'debt';
  return 'forecast';
}

export function AheadView() {
  const [route, navigate] = useRoute();
  const pane = paneFor(route);

  // Keep the document in step when somebody arrives on a bare route.
  useEffect(() => {
    if (route !== 'forecast' && route !== 'calendar' && route !== 'debt') {
      navigate('forecast');
    }
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
          { value: 'debt', label: 'Payoff' },
        ]}
      />

      {pane === 'calendar' && <SubscriptionAudit />}

      {pane === 'forecast' ? (
        <ForecastView />
      ) : pane === 'calendar' ? (
        <CalendarView />
      ) : (
        <DebtPayoffView />
      )}
    </div>
  );
}
