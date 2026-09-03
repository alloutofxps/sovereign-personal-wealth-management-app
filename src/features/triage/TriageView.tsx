/* ===========================================================================
 * THE REVIEW QUEUE
 * ---------------------------------------------------------------------------
 * One swipe per payment. The queue is meant to empty, and reaching the end is
 * the reward — no badge, no streak, just a finished job and a clear screen.
 * ======================================================================== */

import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { minor } from '@/core/money';
import type { CardCredit } from '@/core/ledger';
import { ACCOUNT_IDS, CATEGORIES } from '@/data/seed';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import {
  STAGING_TABLES,
  ignoreRow,
  listUnreviewed,
  type StagedRow,
} from '@/data/repositories/stagingRepo';
import { confirmStagedRow, voidEntry } from '@/app/ledger/actions';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { useRoute } from '@/app/router';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Card, Money, SwipeRow } from '@/design/ui';
import {
  SplitEditor,
  allocated,
  newDraftLine,
  toSplitLines,
  type DraftLine,
} from '@/features/entry/SplitEditor';
import { ProtectStorage } from '@/features/storage/ProtectStorage';
import { ImportSheet } from './ImportSheet';

export function TriageView() {
  const [, navigate] = useRoute();
  const locale = useAppConfig((s) => s.locale);
  const queue = useLiveQuery(useCallback(() => listUnreviewed(), []), STAGING_TABLES);
  const [choosing, setChoosing] = useState<StagedRow | null>(null);
  const [importing, setImporting] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitLines, setSplitLines] = useState<DraftLine[]>([]);

  const rows = queue.data ?? [];

  function closeSheet() {
    setChoosing(null);
    setSplitting(false);
    setSplitLines([]);
  }

  async function confirm(
    row: StagedRow,
    categoryId: string,
    extra?: { split?: DraftLine[]; cardCredit?: CardCredit },
  ) {
    const category = CATEGORIES.find((c) => c.categoryId === categoryId);
    if (!category) return;
    const lines = extra?.split ? toSplitLines(extra.split) : [];
    try {
      const id = await confirmStagedRow(row, {
        categoryId: category.categoryId,
        envelopeId: category.envelopeId,
        categoryName: category.name,
        ...(lines.length >= 2 ? { split: lines } : {}),
        ...(extra?.cardCredit ? { cardCredit: extra.cardCredit } : {}),
      });
      closeSheet();
      const filed =
        lines.length >= 2
          ? `Split across ${lines.length} categories.`
          : extra?.cardCredit?.kind === 'bill_payment'
            ? 'Filed as paying your card bill. It is not counted as spending or income.'
            : extra?.cardCredit?.kind === 'refund'
              ? `Filed as a refund, so your ${category.name.toLowerCase()} spending goes down.`
              : `Filed under ${category.name.toLowerCase()}.`;
      toast(filed, {
        action: {
          label: 'Undo',
          run: () => {
            // Undoing puts the row back in the queue rather than losing it.
            void voidEntry(id)
              .then(() => toast('Undone. It is back in your queue to review.'))
              .catch((error: unknown) =>
                toast(
                  error instanceof Error
                    ? error.message
                    : 'That could not be undone, so nothing has been changed.',
                  { tone: 'attention' },
                ),
              );
          },
        },
      });
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
        onClose={closeSheet}
        title={choosing ? `What was ${choosing.description.toLowerCase()}?` : 'What was it?'}
        description={
          choosing && isCardCredit(choosing)
            ? 'Money arriving on a card is one of two things, and they are recorded differently.'
            : choosing && choosing.amount > 0
              ? 'Money coming in goes down as income.'
              : 'Pick where this belongs and it will be filed straight away.'
        }
      >
        {choosing && isCardCredit(choosing) ? (
          /* Money onto a card is never income. It is the bill being paid or a
             shop giving something back, and only the person knows which. */
          <CardCreditChoice row={choosing} onChoose={confirm} />
        ) : choosing && choosing.amount > 0 ? (
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-body text-ink">
              This is money coming in, so there is nothing to categorise.
            </p>
            <Button variant="primary" onClick={() => void confirm(choosing, CATEGORIES[0]!.categoryId)}>
              File it as money in
            </Button>
          </div>
        ) : splitting && choosing ? (
          <div className="flex flex-col gap-4 pb-2">
            <SplitEditor
              total={minor(-choosing.amount)}
              lines={splitLines}
              onChange={setSplitLines}
            />
            <div className="flex gap-2">
              <Button variant="secondary" block onClick={() => setSplitting(false)}>
                It was all one thing
              </Button>
              <Button
                variant="primary"
                block
                disabled={
                  allocated(splitLines) !== minor(-choosing.amount) ||
                  toSplitLines(splitLines).length < 2
                }
                onClick={() =>
                  void confirm(choosing, toSplitLines(splitLines)[0]!.categoryId, {
                    split: splitLines,
                  })
                }
              >
                File the split
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pb-2">
            <div className="grid grid-cols-2 gap-2">
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

            <Button
              variant="secondary"
              onClick={() => {
                setSplitLines([newDraftLine(), newDraftLine()]);
                setSplitting(true);
              }}
            >
              It was more than one thing
            </Button>
          </div>
        )}
      </BottomSheet>

      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

/** Money arriving on a credit card, which needs a question rather than a guess. */
function isCardCredit(row: StagedRow): boolean {
  return row.amount > 0 && row.accountId === ACCOUNT_IDS.card;
}

function CardCreditChoice({
  row,
  onChoose,
}: {
  row: StagedRow;
  onChoose: (
    row: StagedRow,
    categoryId: string,
    extra?: { cardCredit: CardCredit },
  ) => void | Promise<void>;
}) {
  const [refunding, setRefunding] = useState(false);

  if (refunding) {
    return (
      <div className="flex flex-col gap-3 pb-2">
        <p className="text-caption text-ink-2">
          Which category was the original purchase in? The refund will take the money back off
          that, rather than counting as something you earned.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map((category) => (
            <button
              key={category.categoryId}
              type="button"
              onClick={() => void onChoose(row, category.categoryId, {
                cardCredit: { kind: 'refund' },
              })}
              className={clsx(
                'rounded-md border border-line bg-raised px-3 py-3 text-left text-body text-ink',
                'transition-colors hover:border-line-strong',
              )}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      <Choice
        title="You paid the card bill"
        body="Money moved from your own account to bring the balance down. It is not spending
              and it is not income — you already counted the spending when the card was used."
        onClick={() =>
          void onChoose(row, CATEGORIES[0]!.categoryId, {
            cardCredit: {
              kind: 'bill_payment',
              paidFromAccountId: ACCOUNT_IDS.everyday,
              paidFromName: 'your everyday account',
            },
          })
        }
      />
      <Choice
        title="A shop gave money back"
        body="A return or a refund. It comes off what you spent in that category rather than
              counting as money you earned."
        onClick={() => setRefunding(true)}
      />
    </div>
  );
}

function Choice({
  title,
  body,
  onClick,
}: {
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex flex-col gap-1 rounded-md border border-line bg-raised px-3.5 py-3 text-left',
        'transition-colors hover:border-line-strong',
      )}
    >
      <span className="text-body text-ink">{title}</span>
      <span className="text-caption text-ink-3">{body}</span>
    </button>
  );
}
