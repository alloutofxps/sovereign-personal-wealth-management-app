/* ===========================================================================
 * LOOKING AT ONE PAYMENT
 * ---------------------------------------------------------------------------
 * What it was, when, where the money came from, and anything you noted about
 * it — plus the way to take it back.
 *
 * Taking it back does not delete anything. The mirror image is posted, both
 * entries stay in the history, and every balance returns to where it was. A
 * ledger you can quietly rewrite is a ledger you cannot trust, so a correction
 * is something that happened rather than something that never did.
 * ======================================================================== */

import { useState } from 'react';
import type { EntryWithPostings } from '@/data/repositories/ledgerRepo';
import { voidEntry } from '@/app/ledger/actions';
import { useAccounts } from '@/app/ledger/useLedger';
import { presentEntry } from '@/app/ledger/present';
import { describeDate } from '@/app/dates';
import { useAppConfig } from '@/app/config/store';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Money } from '@/design/ui';

export function PaymentDetailsSheet({
  entry,
  onClose,
}: {
  entry: EntryWithPostings | null;
  onClose: () => void;
}) {
  const locale = useAppConfig((s) => s.locale);
  const accounts = useAccounts();
  // Account ids are for the database. What a person reads is the name they
  // gave it, so the lines below say "Credit card", never "acc-card".
  const nameOf = (id: string) =>
    accounts.data?.find((a) => a.id === id)?.name ?? 'Another account';
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const isCorrection = entry?.kind === 'REVERSAL';
  // The note rides on the entry's first line, so this finds it wherever a
  // builder happened to put it.
  const note = entry?.postings.find((p) => p.memo)?.memo ?? null;
  const byId = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const shown = entry ? presentEntry(entry, byId) : null;
  // A split is worth the sum of its parts, not the size of its first line.
  const amount = shown?.amount ?? null;

  async function undo() {
    if (!entry) return;
    setBusy(true);
    try {
      await voidEntry(entry.id);
      toast('Undone. Everything is back where it was.');
      onClose();
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'That could not be undone, so nothing has been changed.',
        { tone: 'attention' },
      );
    }
    setBusy(false);
    setConfirming(false);
  }

  return (
    <BottomSheet
      open={entry !== null}
      onClose={() => {
        setConfirming(false);
        onClose();
      }}
      title="This payment"
    >
      {entry && (
        <div className="flex flex-col gap-5 pb-2">
          <div className="flex flex-col gap-1">
            <p className="text-body text-ink">{entry.description}</p>
            <p className="text-caption text-ink-3">{describeDate(entry.date, locale)}</p>
          </div>

          {amount !== null && (
            <div>
              <Money value={amount} size="figure" />
            </div>
          )}

          {note && (
            <Detail label="Your note">
              <p className="text-body text-ink">{note}</p>
            </Detail>
          )}

          {shown && shown.categories.length > 1 && (
            <Detail
              label={
                // A loan payment has two lines because the contract says so,
                // not because anybody divided it up.
                shown.isSplit
                  ? `Split across ${shown.categories.length} categories`
                  : 'What this payment was made of'
              }
            >
              <ul className="flex flex-col gap-2">
                {shown.categories.map((part) => (
                  <li key={part.accountId} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-body text-ink">{part.name}</span>
                      {part.memo && (
                        <span className="block truncate text-caption text-ink-3">
                          {part.memo}
                        </span>
                      )}
                    </span>
                    <Money value={part.amount} size="body" />
                  </li>
                ))}
              </ul>
            </Detail>
          )}

          <Detail label="What it moved">
            <ul className="flex flex-col gap-1.5">
              {entry.postings
                .filter((p) => p.book === 'FINANCIAL')
                .map((posting) => (
                  <li key={posting.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-caption text-ink-2">
                      {nameOf(posting.accountId)}
                    </span>
                    <Money value={posting.amount} size="caption" signDisplay="always" />
                  </li>
                ))}
            </ul>
          </Detail>

          {isCorrection ? (
            <p className="text-caption text-ink-3">
              This entry is itself a correction — it undid an earlier payment. To put that
              payment back, record it again.
            </p>
          ) : confirming ? (
            <div className="flex flex-col gap-3">
              <p className="text-caption text-ink">
                This will put every balance back where it was before you recorded this. Both this
                payment and the correction stay in your history, so the change is always
                explainable. Are you sure?
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" block onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
                <Button variant="primary" block disabled={busy} onClick={() => void undo()}>
                  {busy ? 'Undoing…' : 'Yes, undo it'}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setConfirming(true)}>
                Undo this payment
              </Button>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}
