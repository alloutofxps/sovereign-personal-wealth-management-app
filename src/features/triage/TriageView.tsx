/* ===========================================================================
 * THE REVIEW QUEUE
 * ---------------------------------------------------------------------------
 * One swipe per payment. The queue is meant to empty, and reaching the end is
 * the reward — no badge, no streak, just a finished job and a clear screen.
 * ======================================================================== */

import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { minor } from '@/core/money';
import type { AccountId, CardCredit } from '@/core/ledger';
import { ACCOUNT_IDS } from '@/data/seed';
import { useLiveQuery } from '@/data/live/useLiveQuery';
import {
  STAGING_TABLES,
  ignoreRow,
  listUnreviewed,
  type StagedRow,
} from '@/data/repositories/stagingRepo';
import {
  confirmStagedRow,
  fileStagedRows,
  ignoreStagedRows,
  noteScheduledCharge,
  voidEntry,
} from '@/app/ledger/actions';
import { useSelection } from '@/app/selection';
import { describeSelection } from '@/core/taxonomy/tags';
import { SelectionBar, Tick } from '@/features/shell/SelectionBar';
import { applyRulesToStagedRows } from '@/ingest';
import { useCategoryPicker, useRules } from '@/app/taxonomy/useTaxonomy';
import { recordRuleMatches, saveRule } from '@/data/repositories/rulesRepo';
import { AlwaysFileToggle, CategoryPicker } from '@/features/categories/CategoryPicker';
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
  const picker = useCategoryPicker();
  const rules = useRules();
  const [splitting, setSplitting] = useState(false);
  const [chosen, setChosen] = useState<AccountId | null>(null);
  const [alwaysFile, setAlwaysFile] = useState(false);
  const [splitLines, setSplitLines] = useState<DraftLine[]>([]);

  const rows = queue.data ?? [];

  // Selection is pruned against the live queue, so a row filed in another tab
  // cannot still be sitting in a batch about to be filed again here.
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useSelection(rowIds);
  const [filingBatch, setFilingBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const chosenRows = useMemo(
    () => rows.filter((row) => selection.has(row.id)),
    [rows, selection],
  );

  /**
   * Run the person's rules across the queue before they look at it.
   *
   * Applied on the way out of the database rather than on the way in, so a
   * rule written today also files whatever was already waiting — and so a
   * paused rule stops applying immediately rather than leaving already-marked
   * rows behind. Nothing is committed: a matched row shows what matched it and
   * can still be changed.
   */
  const ruled = useMemo(
    () => applyRulesToStagedRows(rows, rules.data ?? []),
    [rows, rules.data],
  );
  const matchByRow = useMemo(
    () => new Map(ruled.rows.map((r) => [r.row.id, r.match])),
    [ruled.rows],
  );

  function closeSheet() {
    setChoosing(null);
    setSplitting(false);
    setSplitLines([]);
    setChosen(null);
    setAlwaysFile(false);
  }

  async function confirm(
    row: StagedRow,
    categoryId: string,
    extra?: { split?: DraftLine[]; cardCredit?: CardCredit },
  ) {
    const category = picker.byId.get(categoryId);
    if (!category) return;
    const lines = extra?.split ? toSplitLines(extra.split, picker.byId) : [];
    try {
      const id = await confirmStagedRow(row, {
        categoryId: category.categoryId,
        envelopeId: category.envelopeId,
        categoryName: category.name,
        ...(lines.length >= 2 ? { split: lines } : {}),
        ...(extra?.cardCredit ? { cardCredit: extra.cardCredit } : {}),
      });
      // "Always file this shop here", offered on the row itself.
      if (alwaysFile && row.description.trim() && lines.length === 0) {
        await saveRule({
          pattern: row.description.trim(),
          categoryId: category.categoryId,
          envelopeId: category.envelopeId,
        });
      }

      // If this row is one of their known bills, remember what it actually
      // cost. The audit compares it to the baseline; nothing is raised here.
      if (row.amount < 0) {
        void noteScheduledCharge(row.description, minor(-row.amount));
      }

      const firedRule = matchByRow.get(row.id);
      if (firedRule && firedRule.categoryId === categoryId) {
        void recordRuleMatches([firedRule.ruleId]);
      }

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

  /**
   * File everything chosen to one category.
   *
   * Deliberately does not offer to write a rule. Filing thirty rows together
   * usually means they are thirty different shops that all belong in one
   * place, and turning that into thirty rules would fill the rules screen with
   * things nobody wrote.
   */
  async function fileChosen(categoryId: string) {
    const category = picker.byId.get(categoryId);
    if (!category || chosenRows.length === 0) return;

    setBatchBusy(true);
    try {
      const result = await fileStagedRows(chosenRows, {
        categoryId: category.categoryId,
        envelopeId: category.envelopeId,
        categoryName: category.name,
      });

      setFilingBatch(false);
      selection.cancel();

      const filed = result.filed.length;
      const said =
        result.refused.length === 0
          ? `Filed ${filed} ${filed === 1 ? 'payment' : 'payments'} under ${category.name.toLowerCase()}.`
          : `Filed ${filed} under ${category.name.toLowerCase()}. ` +
            `${result.refused.length} could not be filed and ${result.refused.length === 1 ? 'is' : 'are'} ` +
            `still in your queue.`;

      toast(said, {
        ...(filed > 0
          ? {
              action: {
                label: 'Undo',
                run: () => {
                  void Promise.all(result.filed.map((id) => voidEntry(id)))
                    .then(() =>
                      toast(`Undone. ${filed === 1 ? 'It is' : 'They are'} back in your queue.`),
                    )
                    .catch((error: unknown) =>
                      toast(
                        error instanceof Error
                          ? error.message
                          : 'Some of those could not be undone. Your queue shows where they are.',
                        { tone: 'attention' },
                      ),
                    );
                },
              },
            }
          : {}),
        ...(result.refused.length > 0 ? { tone: 'attention' as const } : {}),
      });
    } finally {
      setBatchBusy(false);
    }
  }

  async function setAsideChosen() {
    if (chosenRows.length === 0) return;
    setBatchBusy(true);
    try {
      const { ignored, refused } = await ignoreStagedRows(chosenRows);
      selection.cancel();
      toast(
        refused === 0
          ? `Set ${ignored} aside. ${ignored === 1 ? 'It is' : 'They are'} out of your queue and nothing was recorded.`
          : `Set ${ignored} aside. ${refused} could not be moved and ${refused === 1 ? 'is' : 'are'} still there.`,
        refused > 0 ? { tone: 'attention' } : {},
      );
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">To review</h1>
        <p className="text-caption text-ink-2">
          {rows.length === 0
            ? 'Anything brought in from your bank waits here for a quick look.'
            : ruled.matchedCount > 0
              ? `${rows.length} to go. ${ruled.matchedCount} already matched one of your rules. Tap to confirm.`
              : `${rows.length} ${rows.length === 1 ? 'payment' : 'payments'} to go. Swipe right to file one, left to set it aside.`}
        </p>
        {rows.length > 1 && !selection.active && (
          <button
            type="button"
            onClick={() => selection.begin()}
            className="self-start pt-1 text-caption text-liquid hover:text-liquid-bright"
          >
            Choose several at once
          </button>
        )}
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
                  <RowShell
                    selecting={selection.active}
                    chosen={selection.has(row.id)}
                    onToggle={() => selection.toggle(row.id)}
                    onOpen={() => {
                      setChosen((matchByRow.get(row.id)?.categoryId ?? null) as AccountId | null);
                      setChoosing(row);
                    }}
                    onIgnore={() => void ignoreRow(row.id)}
                  >
                    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                      {selection.active && <Tick on={selection.has(row.id)} />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body text-ink">{row.description}</p>
                        <p className="truncate pt-0.5 text-caption text-ink-3">
                          {describeDate(row.date, locale)}
                        </p>
                        {matchByRow.get(row.id) && (
                          <p className="truncate pt-1 text-caption text-liquid">
                            Rule matched: &ldquo;{matchByRow.get(row.id)!.pattern}&rdquo; →{' '}
                            {picker.byId.get(matchByRow.get(row.id)!.categoryId)?.name ??
                              'a category'}
                          </p>
                        )}
                      </div>
                      <Money
                        value={row.amount}
                        size="lead"
                        tone={row.amount > 0 ? 'liquid' : 'neutral'}
                      />
                    </div>
                  </RowShell>
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
          <CardCreditChoice
            row={choosing}
            onChoose={confirm}
            anyCategoryId={picker.all[0]?.categoryId ?? ''}
          />
        ) : choosing && choosing.amount > 0 ? (
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-body text-ink">
              This is money coming in, so there is nothing to categorise.
            </p>
            <Button
              variant="primary"
              disabled={picker.all.length === 0}
              onClick={() => picker.all[0] && void confirm(choosing, picker.all[0].categoryId)}
            >
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
                  toSplitLines(splitLines, picker.byId).length < 2
                }
                onClick={() =>
                  void confirm(choosing, toSplitLines(splitLines, picker.byId)[0]!.categoryId, {
                    split: splitLines,
                  })
                }
              >
                File the split
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-2">
            <CategoryPicker
              value={chosen}
              onChange={setChosen}
              merchant={choosing?.description ?? ''}
              onPrediction={(predicted) => setChosen((current) => current ?? predicted)}
            />

            {chosen && picker.byId.get(chosen) && (
              <AlwaysFileToggle
                merchant={choosing?.description ?? ''}
                categoryName={picker.byId.get(chosen)!.name}
                checked={alwaysFile}
                onChange={setAlwaysFile}
              />
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                block
                onClick={() => {
                  setSplitLines([newDraftLine(), newDraftLine()]);
                  setSplitting(true);
                }}
              >
                More than one thing
              </Button>
              <Button
                variant="primary"
                block
                disabled={!chosen}
                onClick={() => chosen && choosing && void confirm(choosing, chosen)}
              >
                File it
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>

      {selection.active && (
        <SelectionBar
          count={selection.count}
          summary={describeSelection(selection.count)}
          allChosen={selection.allChosen}
          onSelectAll={selection.selectAll}
          onCancel={selection.cancel}
          actions={[
            {
              label: batchBusy ? 'Filing…' : 'File them all as…',
              primary: true,
              disabled: batchBusy,
              onAction: () => setFilingBatch(true),
            },
            {
              label: 'Set them aside',
              disabled: batchBusy,
              onAction: () => void setAsideChosen(),
            },
          ]}
        />
      )}

      <BottomSheet
        open={filingBatch}
        onClose={() => setFilingBatch(false)}
        title={`File ${selection.count} ${selection.count === 1 ? 'payment' : 'payments'}`}
        description="They will all go to the same category. Anything that refuses stays in your queue."
      >
        <div className="pb-2">
          <CategoryPicker
            value={null}
            label="Where do they all belong?"
            onChange={(id) => void fileChosen(id)}
          />
        </div>
      </BottomSheet>

      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

/** Money arriving on a credit card, which needs a question rather than a guess. */
/**
 * A queue row, which is two quite different things depending on the mode.
 *
 * Normally it swipes: right to file, left to set aside. While a batch is being
 * chosen it does not, and tapping ticks instead of opening. Leaving the swipes
 * live during selection would mean the same gesture sometimes files one thing
 * and sometimes ticks it, which is how somebody ends up filing fourteen rows
 * they meant to choose.
 */
function RowShell({
  selecting,
  chosen,
  onToggle,
  onOpen,
  onIgnore,
  children,
}: {
  selecting: boolean;
  chosen: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onIgnore: () => void;
  children: React.ReactNode;
}) {
  if (selecting) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={chosen}
        className={clsx(
          'block w-full text-left transition-colors',
          chosen ? 'bg-liquid-wash' : 'hover:bg-raised',
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <SwipeRow
      leftAction={{ label: 'File it', tone: 'liquid', onAction: onOpen }}
      rightAction={{ label: 'Not mine', tone: 'caution', onAction: onIgnore }}
      onClick={onOpen}
    >
      {children}
    </SwipeRow>
  );
}

function isCardCredit(row: StagedRow): boolean {
  return row.amount > 0 && row.accountId === ACCOUNT_IDS.card;
}

function CardCreditChoice({
  row,
  onChoose,
  anyCategoryId,
}: {
  row: StagedRow;
  /** A bill payment touches no category, but the call still needs one. */
  anyCategoryId: string;
  onChoose: (
    row: StagedRow,
    categoryId: string,
    extra?: { cardCredit: CardCredit },
  ) => void | Promise<void>;
}) {
  const [refunding, setRefunding] = useState(false);
  const [refundCategory, setRefundCategory] = useState<AccountId | null>(null);

  if (refunding) {
    return (
      <div className="flex flex-col gap-3 pb-2">
        <p className="text-caption text-ink-2">
          Which category was the original purchase in? The refund will take the money back off
          that, rather than counting as something you earned.
        </p>
        <CategoryPicker
          value={refundCategory}
          onChange={setRefundCategory}
          label="Which category was it?"
        />
        <Button
          variant="primary"
          disabled={!refundCategory}
          onClick={() =>
            refundCategory &&
            void onChoose(row, refundCategory, { cardCredit: { kind: 'refund' } })
          }
        >
          File it as a refund
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      <Choice
        title="You paid the card bill"
        body="Money moved from your own account to bring the balance down. It is not spending
              and it is not income. You counted the spending when the card was used."
        onClick={() =>
          void onChoose(row, anyCategoryId, {
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
