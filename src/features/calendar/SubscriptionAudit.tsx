/* ===========================================================================
 * THE SUBSCRIPTION AUDIT
 * ---------------------------------------------------------------------------
 * Three quiet observations: this went up, you have not used this in a while,
 * and this looks like a subscription you never wrote down.
 *
 * All of it in amber, none of it in red. A streaming service costing two euros
 * more is not an emergency, and an app that shouts about one has spent the
 * attention it will need on the day something is genuinely wrong. Every notice
 * here states the fact, offers the way out, and then stops talking.
 * ======================================================================== */

import { useState } from 'react';
import { CADENCE_LABELS } from '@/core/recurring';
import { useSubscriptionAudit } from '@/app/calendar/useSurveillance';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import {
  dismissDormantAlert,
  saveScheduled,
  updateExpectedAmount,
} from '@/data/repositories/scheduleRepo';
import { toIsoDate } from '@/core/liquidity';
import { Button, Card, Money } from '@/design/ui';

export function SubscriptionAudit() {
  const audit = useSubscriptionAudit();
  const money = useMoney();
  const [busy, setBusy] = useState<string | null>(null);

  const data = audit.data;
  const nothing =
    data &&
    data.priceChanges.length === 0 &&
    data.dormant.length === 0 &&
    data.candidates.length === 0;

  if (!data || nothing) return null;

  return (
    <Card label="Worth a look" accent="caution">
      <div className="flex flex-col gap-4">
        {data.priceChanges.map((change) => (
          <div key={change.itemId} className="flex flex-col gap-2">
            <p className="text-body text-ink">
              {change.name} charged {money.format(change.chargedAmount)} instead of your usual{' '}
              {money.format(change.expectedAmount)}.
            </p>
            <p className="text-caption text-ink-2">
              That is {money.format(change.increase)} more each time,{' '}
              {money.format(change.annualisedIncrease)} over a year if it stays this way.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy === change.itemId}
                onClick={() => {
                  setBusy(change.itemId);
                  void updateExpectedAmount(change.itemId, change.chargedAmount)
                    .then(() =>
                      toast(
                        `${change.name} is now down as ${money.format(change.chargedAmount)}.`,
                      ),
                    )
                    .finally(() => setBusy(null));
                }}
              >
                Update it to {money.format(change.chargedAmount)}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy === change.itemId}
                onClick={() => {
                  setBusy(change.itemId);
                  // Clearing the recorded charge leaves the baseline alone and
                  // stops this particular one being raised again.
                  void recordOneOff(change.itemId)
                    .then(() => toast('Left as it was. This one is treated as a one-off.'))
                    .finally(() => setBusy(null));
                }}
              >
                Just this once
              </Button>
            </div>
          </div>
        ))}

        {data.dormant.map((quiet) => (
          <div key={quiet.itemId} className="flex flex-col gap-2">
            <p className="text-body text-ink">
              You are still paying {money.format(quiet.amount)} for {quiet.name}, and nothing has
              gone through that category in about {Math.round(quiet.weeksQuiet / 4)} months.
            </p>
            <p className="text-caption text-ink-2">
              Still using it? If not, cancelling would put {money.format(quiet.amount)} a month
              back in your pocket.
            </p>
            <div>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy === quiet.itemId}
                onClick={() => {
                  setBusy(quiet.itemId);
                  void dismissDormantAlert(quiet.itemId)
                    .then(() => toast('Fair enough. Sovereign will stop asking about that one.'))
                    .finally(() => setBusy(null));
                }}
              >
                It is fine, stop asking
              </Button>
            </div>
          </div>
        ))}

        {data.candidates.map((candidate) => (
          <div key={candidate.merchant} className="flex flex-col gap-2">
            <p className="text-body text-ink">
              {titleCase(candidate.merchant)} has charged you{' '}
              <Money value={candidate.amount} size="body" /> {candidate.occurrences} times,{' '}
              {CADENCE_LABELS[candidate.cadenceGuess].toLowerCase()}. It is not in your bills.
            </p>
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy === candidate.merchant}
                onClick={() => {
                  setBusy(candidate.merchant);
                  void saveScheduled({
                    id: crypto.randomUUID(),
                    kind: 'bill',
                    name: titleCase(candidate.merchant),
                    amount: candidate.amount,
                    nextDue: toIsoDate(new Date()),
                    cadence: candidate.cadenceGuess,
                    accountId: null,
                    categoryId: null,
                    active: true,
                    expectedAmount: candidate.amount,
                    lastAmount: null,
                    lastBilledDate: candidate.lastSeen,
                    dormantAlertDismissedAt: null,
                  })
                    .then(() =>
                      toast(
                        `Added ${titleCase(candidate.merchant)}. It is now held back from what ` +
                          `is safe to spend.`,
                      ),
                    )
                    .finally(() => setBusy(null));
                }}
              >
                Add it to my bills
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Clear the recorded charge so the same rise is not raised twice. */
async function recordOneOff(itemId: string): Promise<void> {
  const { listScheduled, recordActualCharge } = await import(
    '@/data/repositories/scheduleRepo'
  );
  const items = await listScheduled();
  const item = items.find((i) => i.id === itemId);
  if (!item) return;
  await recordActualCharge(itemId, item.expectedAmount, item.lastBilledDate ?? toIsoDate(new Date()));
}

/** "SPOTIFY" reads badly in a sentence; "Spotify" does not. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
