/* ===========================================================================
 * BRINGING IN A STATEMENT
 * ---------------------------------------------------------------------------
 * Pick a file, check Sovereign has read the columns right, and send the rows
 * to the review queue.
 *
 * The file is read in this tab and never leaves the device. The mapping step
 * is not a formality: when the date order cannot be proved from the data, this
 * is where the person is asked rather than the app quietly guessing and
 * scattering their statement across two months.
 * ======================================================================== */

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { minorUnitExponent } from '@/core/money';
import type { AccountId } from '@/core/ledger';
import {
  buildCandidates,
  describeImport,
  inspectFile,
  type ColumnMapping,
  type ImportResult,
  type ParsedFile,
} from '@/ingest';
import { stageRows } from '@/data/repositories/stagingRepo';
import { ACCOUNT_IDS } from '@/data/seed';
import { useAppConfig } from '@/app/config/store';
import { toast } from '@/app/toast';
import { BottomSheet, Button, Money } from '@/design/ui';

type Step = 'choose' | 'map' | 'done';

const ACCOUNT_CHOICES: { id: AccountId; label: string }[] = [
  { id: ACCOUNT_IDS.everyday, label: 'Everyday account' },
  { id: ACCOUNT_IDS.savings, label: 'Savings' },
  { id: ACCOUNT_IDS.card, label: 'Credit card' },
];

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const currency = useAppConfig((s) => s.currencyCode);
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('choose');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [account, setAccount] = useState<AccountId>(ACCOUNT_IDS.everyday);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setFileName('');
    setParsed(null);
    setMapping(null);
    setPreview(null);
    setProblem(null);
    setBusy(false);
  }, [open]);

  async function readFile(file: File) {
    setBusy(true);
    setProblem(null);
    try {
      const text = await file.text();
      const inspected = inspectFile(text);

      if (inspected.rows.length === 0) {
        setProblem(
          'There are no rows in that file that Sovereign can read. It may be a PDF or an ' +
            'image rather than a spreadsheet. Most banks offer a CSV download as well.',
        );
        setBusy(false);
        return;
      }

      setFileName(file.name);
      setParsed(inspected);
      setMapping(inspected.suggested);
      setPreview(buildCandidates(inspected, inspected.suggested, account, minorUnitExponent(currency)));
      setStep('map');
    } catch {
      setProblem('Sovereign could not open that file. Nothing has been changed.');
    }
    setBusy(false);
  }

  function updateMapping(change: Partial<ColumnMapping>) {
    if (!parsed || !mapping) return;
    const next = { ...mapping, ...change };
    setMapping(next);
    setPreview(buildCandidates(parsed, next, account, minorUnitExponent(currency)));
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await stageRows(preview.rows, account);
      // Somebody who has just imported a statement has demonstrably invested
      // something in this app, and that is the moment worth asking the browser
      // to keep their data. The asking is done by <ProtectStorage> on the
      // review queue behind this sheet, with a sentence explaining why, rather
      // than silently from here — Firefox turns this call into a permission
      // dialog, and one that appears unannounced while a sheet is closing gets
      // dismissed on reflex.
      toast(describeImport(preview, result.duplicates));
      setStep('done');
      onClose();
    } catch (error) {
      setProblem(
        error instanceof Error
          ? `That did not save: ${error.message}`
          : 'That did not save. Nothing has been changed, so you can try again.',
      );
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title={step === 'choose' ? 'Bring in a statement' : 'Does this look right?'}
      {...(step === 'choose'
        ? { description: 'The file is read here on your device and never sent anywhere.' }
        : {})}
      {...(step === 'map'
        ? {
            footer: (
          <div className="flex flex-col gap-2">
            {problem && (
              <p className="text-caption text-caution" role="alert">
                {problem}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" block onClick={() => setStep('choose')}>
                Pick another file
              </Button>
              <Button
                variant="primary"
                block
                disabled={busy || !preview || preview.rows.length === 0}
                onClick={() => void commit()}
              >
                {busy ? 'Adding…' : `Add ${preview?.rows.length ?? 0} to review`}
              </Button>
              </div>
            </div>
          ),
        }
      : {})}
    >
      {step === 'choose' ? (
        <div className="flex flex-col gap-5 pb-2">
          <Field label="Which account is this from?">
            <div className="flex flex-col gap-2">
              {ACCOUNT_CHOICES.map((choice) => (
                <Choice
                  key={choice.id}
                  selected={account === choice.id}
                  onClick={() => setAccount(choice.id)}
                >
                  {choice.label}
                </Choice>
              ))}
            </div>
          </Field>

          <div className="flex flex-col gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <Button variant="primary" block onClick={() => fileInput.current?.click()}>
              {busy ? 'Reading…' : 'Choose a file'}
            </Button>
            <p className="text-caption text-ink-3">
              Most banks offer a CSV download somewhere in their statements section. Sovereign
              reads it here in this tab. Nothing is uploaded and no account details are needed.
            </p>
            {problem && (
              <p className="text-caption text-caution" role="alert">
                {problem}
              </p>
            )}
          </div>
        </div>
      ) : (
        parsed &&
        mapping &&
        preview && (
          <div className="flex flex-col gap-5 pb-2">
            <p className="text-caption text-ink-2">
              {fileName} · {describeImport(preview, 0)}
            </p>

            {parsed.dateIsAmbiguous && (
              <div className="flex flex-col gap-2 rounded-md border border-caution-dim/50 bg-caution-wash px-3.5 py-3">
                <p className="text-caption text-caution">
                  Sovereign cannot tell from this file whether the dates are day-first or
                  month-first. Getting it wrong would spread your statement across two months, so
                  please check the dates below look right.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(['dmy', 'mdy', 'ymd'] as const).map((order) => (
                    <Choice
                      key={order}
                      selected={mapping.dateOrder === order}
                      onClick={() => updateMapping({ dateOrder: order })}
                    >
                      {order === 'dmy' ? 'Day first' : order === 'mdy' ? 'Month first' : 'Year first'}
                    </Choice>
                  ))}
                </div>
              </div>
            )}

            <Field label="What Sovereign will bring in">
              <ul className="flex flex-col gap-1">
                {preview.rows.slice(0, 6).map((row) => (
                  <li
                    key={row.dedupeKey}
                    className="flex items-center justify-between gap-3 rounded-md border border-line bg-raised px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body text-ink">{row.description}</span>
                      <span className="block text-caption text-ink-3">{row.date}</span>
                    </span>
                    <Money value={row.amount} size="body" />
                  </li>
                ))}
              </ul>
              {preview.rows.length > 6 && (
                <p className="text-caption text-ink-3">
                  …and {preview.rows.length - 6} more.
                </p>
              )}
            </Field>

            <Field label="Are these the right way round?">
              <Choice
                selected={mapping.outflowIsPositive}
                onClick={() => updateMapping({ outflowIsPositive: !mapping.outflowIsPositive })}
              >
                {mapping.outflowIsPositive
                  ? 'Money going out is written as a positive number'
                  : 'Money going out is written as a negative number'}
              </Choice>
              <p className="text-caption text-ink-3">
                Tap to flip if the amounts above have the wrong sign.
              </p>
            </Field>

            {preview.rejected.length > 0 && (
              <Field label={`${preview.rejected.length} lines could not be read`}>
                <ul className="flex flex-col gap-1">
                  {preview.rejected.slice(0, 4).map((row) => (
                    <li key={row.lineNumber} className="text-caption text-ink-3">
                      Line {row.lineNumber}: {row.reason}
                    </li>
                  ))}
                </ul>
                <p className="text-caption text-ink-3">
                  These are usually totals or notes at the bottom of a statement. They will be
                  left out; nothing else is affected.
                </p>
              </Field>
            )}
          </div>
        )
      )}
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'rounded-md border px-3 py-2.5 text-left text-body transition-colors',
        selected
          ? 'border-liquid-dim bg-liquid-wash text-liquid'
          : 'border-line bg-raised text-ink hover:border-line-strong',
      )}
    >
      {children}
    </button>
  );
}
