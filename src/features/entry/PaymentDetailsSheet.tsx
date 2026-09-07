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

import { useEffect, useState } from 'react';
import type { EntryWithPostings } from '@/data/repositories/ledgerRepo';
import { voidEntry } from '@/app/ledger/actions';
import { updateEntryMetadata } from '@/data/repositories/ledgerRepo';
import { useAccounts } from '@/app/ledger/useLedger';
import { presentEntry } from '@/app/ledger/present';
import { describeDate, describeWhen } from '@/app/dates';
// Deep import on purpose: this sheet is lazily loaded, the barrel is not.
import { describeLocked } from '@/core/reconciliation/reconciliationMath';
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
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  /**
   * The note as just saved, until the sheet is next opened.
   *
   * The `entry` prop is a snapshot taken when the row was tapped, so it still
   * carries the old note after a save — reading it back would show the note
   * disappearing the instant it was written. This holds what was actually
   * stored, and is cleared whenever a different payment is opened.
   */
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const isCorrection = entry?.kind === 'REVERSAL';
  // The note rides on the entry's first line, so this finds it wherever a
  // builder happened to put it.
  const storedNote = entry?.postings.find((p) => p.memo)?.memo ?? null;
  const note = savedNote ?? storedNote;
  const byId = new Map((accounts.data ?? []).map((a) => [a.id, a]));
  const shown = entry ? presentEntry(entry, byId) : null;
  // A split is worth the sum of its parts, not the size of its first line.
  const amount = shown?.amount ?? null;

  useEffect(() => {
    setEditingNote(false);
    setSavedNote(null);
    setDraftNote(entry?.postings.find((p) => p.memo)?.memo ?? '');
  }, [entry]);

  /**
   * Save a note, including onto a locked payment.
   *
   * A statement check locks the money. A note is not money — nothing in this
   * app adds one up — and the moment somebody most wants to write one is while
   * they are checking a statement, which is exactly the moment it becomes
   * locked. See `updateEntryMetadata`.
   */
  async function saveNote() {
    if (!entry) return;
    setBusy(true);
    try {
      await updateEntryMetadata(entry.id, { memo: draftNote });
      // Stays open, showing what was just written. Closing the whole sheet
      // would take the note off screen the moment it was saved, and leave
      // somebody unsure whether it had been.
      setSavedNote(draftNote.trim() === '' ? null : draftNote.trim());
      setEditingNote(false);
      toast(draftNote.trim() === '' ? 'Note removed.' : 'Note saved.');
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'That note could not be saved, so nothing has changed.',
        { tone: 'attention' },
      );
    } finally {
      setBusy(false);
    }
  }

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
            <p className="flex flex-wrap items-center gap-x-2 text-caption text-ink-3">
              <span>{describeDate(entry.date, locale)}</span>
              {shown && shown.clearance !== 'cleared' && (
                <span
                  className={
                    'rounded-pill px-2 py-0.5 text-micro font-medium ' +
                    (shown.clearance === 'reconciled'
                      ? 'bg-liquid-wash text-liquid'
                      : 'bg-raised text-ink-2')
                  }
                >
                  {shown.clearance === 'reconciled'
                    ? 'Checked against your statement'
                    : 'Has not gone through yet'}
                </span>
              )}
            </p>
          </div>

          {amount !== null && (
            <div>
              <Money value={amount} size="figure" />
            </div>
          )}

          <Detail label="Your note">
            {editingNote ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Which trip, whose half, what it was really for…"
                  className="w-full resize-none rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
                />
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDraftNote(note ?? '');
                      setEditingNote(false);
                    }}
                  >
                    Leave it
                  </Button>
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveNote()}>
                    {busy ? 'Saving…' : 'Save the note'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-1.5">
                {note ? (
                  <p className="text-body text-ink">{note}</p>
                ) : (
                  <p className="text-body text-ink-3">Nothing noted about this one.</p>
                )}
                <button
                  type="button"
                  onClick={() => setEditingNote(true)}
                  className="text-caption text-liquid hover:text-liquid-bright"
                >
                  {note ? 'Change the note' : 'Add a note'}
                </button>
              </div>
            )}
          </Detail>

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
              This entry is itself a correction. It undid an earlier payment. To put that
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
          ) : shown && shown.clearance === 'reconciled' ? (
            // Not a hidden button and not a silent failure: the action stays
            // where somebody expects it, visibly unavailable, with the reason
            // underneath. Being told why beats wondering where it went.
            <div className="flex flex-col gap-2">
              <div>
                <Button variant="secondary" disabled>
                  Undo this payment
                </Button>
              </div>
              <p className="max-w-[46ch] text-caption text-ink-2">
                {shown.reconciledAt
                  ? describeLocked(shown.reconciledAt, (iso) => describeWhen(iso, locale))
                  : 'This was locked during a statement check, so it cannot be edited or deleted.'}
              </p>
              <p className="max-w-[46ch] text-caption text-ink-3">
                If it really is wrong, unlock that statement check from the account first. The
                unlock is recorded, so your history still explains itself.
              </p>
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
