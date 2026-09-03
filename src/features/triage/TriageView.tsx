/* ===========================================================================
 * THE REVIEW QUEUE
 * ---------------------------------------------------------------------------
 * One swipe per payment. The queue is meant to empty, and reaching the end is
 * the reward — no badge, no streak, just a finished job and a clear screen.
 * ======================================================================== */

import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { CATEGORIES } from '@/data/seed';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import {
  STAGING_TABLES,
  ignoreRow,
  listUnreviewed,
  type StagedRow,
} from '@/data/repositories/stagingRepo';
import { confirmStagedRow } from '@/app/ledger/actions';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Money, SwipeRow } from '@/design/ui';
import { ProtectStorage } from '@/features/storage/ProtectStorage';
import { ImportSheet } from './ImportSheet';

export function TriageView() {
  const [, navigate] = useRoute();
  const locale = useAppConfig((s) => s.locale);
  const queue = useLiveQuery(useCallback(() => listUnreviewed(), []), STAGING_TABLES);
  const [choosing, setChoosing] = useState<StagedRow | null>(null);
  const [importing, setImporting] = useState(false);

  const rows = queue.data ?? [];

  async function confirm(row: StagedRow, categoryId: string) {
    const category = CATEGORIES.find((c) => c.categoryId === categoryId);
    if (!category) return;
    try {
      await confirmStagedRow(row, {
        categoryId: category.categoryId,
        envelopeId: category.envelopeId,
        categoryName: category.name,
      });
      setChoosing(null);
    } catch (error) {
      toast(
        error instanceof Error
          ? `That did not save: ${error.message}`
          : 'That did not save. Nothing has changed.',
        { tone: 'attention' },
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">To review</h1>
        <p className="text-caption text-ink-2">
          {rows.length === 0
            ? 'Anything brought in from your bank waits here for a quick look.'
            : `${rows.length} ${rows.length === 1 ? 'payment' : 'payments'} to go. Swipe right to file one, left to set it aside.`}
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-lead text-ink">You are all caught up</p>
            <p className="max-w-[36ch] text-caption text-ink-2">
              Nothing is waiting. Bring in a statement from your bank and anything Sovereign is
              not sure about will collect here.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => setImporting(true)}>
                Bring in a statement
              </Button>
              <Button variant="secondary" onClick={() => navigate('home')}>
                Back to your money
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Rows only ever land here from a statement import, so their
              presence is the signal that somebody has just brought real
              history onto this device — the moment the browser is most
              likely to agree to keep it. */}
          <ProtectStorage context="after-import" />

          <Card padding="none">
            <ul className="divide-y divide-line-faint">
              {rows.map((row) => (
                <li key={row.id}>
                  <SwipeRow
                    leftAction={{
                      label: 'File it',
                      tone: 'liquid',
                      onAction: () => setChoosing(row),
                    }}
                    rightAction={{
                      label: 'Not mine',
                      tone: 'caution',
                      onAction: () => void ignoreRow(row.id),
                    }}
                    onClick={() => setChoosing(row)}
                  >
                    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-body text-ink">{row.description}</p>
                        <p className="truncate pt-0.5 text-caption text-ink-3">
                          {describeDate(row.date, locale)}
                        </p>
                      </div>
                      <Money
                        value={row.amount}
                        size="lead"
                        tone={row.amount > 0 ? 'liquid' : 'neutral'}
                      />
                    </div>
                  </SwipeRow>
                </li>
              ))}
            </ul>
          </Card>

          <Button variant="secondary" onClick={() => setImporting(true)}>
            Bring in another statement
          </Button>
        </>
      )}

      <BottomSheet
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        title={choosing ? `What was ${choosing.description.toLowerCase()}?` : 'What was it?'}
        description={
          choosing && choosing.amount > 0
            ? 'Money coming in goes down as income.'
            : 'Pick where this belongs and it will be filed straight away.'
        }
      >
        {choosing && choosing.amount > 0 ? (
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-body text-ink">
              This is money coming in, so there is nothing to categorise.
            </p>
            <Button variant="primary" onClick={() => void confirm(choosing, CATEGORIES[0]!.categoryId)}>
              File it as money in
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 pb-2">
            {CATEGORIES.map((category) => (
              <button
                key={category.categoryId}
                type="button"
                onClick={() => choosing && void confirm(choosing, category.categoryId)}
                className={clsx(
                  'rounded-md border border-line bg-raised px-3 py-3 text-left text-body text-ink',
                  'transition-colors hover:border-line-strong',
                )}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}
      </BottomSheet>

      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
