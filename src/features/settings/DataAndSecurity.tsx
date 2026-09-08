/* ===========================================================================
 * YOUR DATA, AND WHO CAN SEE IT
 * ---------------------------------------------------------------------------
 * Two cards that carry the sovereignty claim: take everything away whenever
 * you like, and put a door on the front. Both say plainly what they do — and,
 * in the lock's case, what it does not do.
 * ======================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  downloadExport,
  listBackups,
  persistenceState,
  requestPersistence,
  restoreFromFile,
  type PersistenceState,
} from '@/data/persistence';
import type { BackupFile } from '@/data/worker/protocol';
import {
  LOCK_EXPLANATION,
  biometricsAvailable,
  lockMethod,
  removeLock,
  setPasscode,
  setUpBiometrics,
  type LockMethod,
} from '@/app/security/lock';
import { toast } from '@/app/toast';
import { lockNow } from '@/features/shell/LockGate';
import { BottomSheet, Button, Card } from '@/design/ui';
import { RecoveryPhrase, phraseIsUsable } from './RecoveryPhrase';

export function DataAndSecurity() {
  return (
    <>
      <YourDataCard />
      <LockCard />
    </>
  );
}

/* --- export and restore --------------------------------------------------- */

function YourDataCard() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<PersistenceState | null>(null);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [exporting, setExporting] = useState(false);
  const [lockWith, setLockWith] = useState<'passphrase' | 'phrase'>('passphrase');
  const [phrase, setPhrase] = useState('');
  const [phraseGood, setPhraseGood] = useState(false);
  const [restoring, setRestoring] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await persistenceState());
    setBackups(await listBackups());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function doExport(withPassphrase: string | null) {
    setBusy(true);
    setProblem(null);
    try {
      const { name } = await downloadExport(withPassphrase);
      toast(
        withPassphrase
          ? `Saved as ${name}. Keep the passphrase somewhere safe. Without it the file cannot be opened by anyone, including us.`
          : `Saved as ${name}. It is a plain SQLite file, so any database tool can read it.`,
      );
      setExporting(false);
      setPassphrase('');
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : 'That did not work. Nothing has changed.',
      );
    }
    setBusy(false);
  }

  async function doRestore() {
    if (!restoring) return;
    setBusy(true);
    setProblem(null);
    try {
      await restoreFromFile(restoring, passphrase.trim() || null);
      toast('Restored. Everything on screen is now from that file.');
      setRestoring(null);
      setPassphrase('');
      void refresh();
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : 'That file could not be restored.',
      );
    }
    setBusy(false);
  }

  return (
    <Card label="Your data">
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-2">
          Everything lives on this device. An export is the whole database in one file: a real
          SQLite file, which any database tool on earth can open. Being able to leave is the
          point.
        </p>

        {state && (
          <p className="text-caption text-ink-3">
            {state.explanation}
            {state.usedBytes !== null && ` Currently using about ${formatBytes(state.usedBytes)}.`}
          </p>
        )}

        {backups.length > 0 && (
          <p className="text-caption text-ink-3">
            Sovereign has {backups.length} automatic{' '}
            {backups.length === 1 ? 'copy' : 'copies'} kept from before past updates, as a safety
            net.
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => setExporting(true)}>
            Export everything
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            Restore from a file
          </Button>
          {state && !state.persisted && (
            <Button
              variant="quiet"
              size="sm"
              onClick={async () => {
                const granted = await requestPersistence();
                toast(
                  granted
                    ? 'Your browser has agreed to keep your data.'
                    : 'Your browser said no for now. Adding Sovereign to your home screen usually changes its mind.',
                );
                void refresh();
              }}
            >
              Ask to keep my data
            </Button>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".svrgn,.sqlite3,.db,application/octet-stream"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setPassphrase('');
              setProblem(null);
              setRestoring(file);
            }
          }}
        />
      </div>

      <BottomSheet
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export everything"
        description="One file with all of it in. Choose whether to lock it first."
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="grid grid-cols-2 gap-2">
            <LockChoice
              selected={lockWith === 'passphrase'}
              onClick={() => setLockWith('passphrase')}
              title="A passphrase"
              detail="Something you will remember."
            />
            <LockChoice
              selected={lockWith === 'phrase'}
              onClick={() => setLockWith('phrase')}
              title="A recovery phrase"
              detail="Twelve words, written down."
            />
          </div>

          {lockWith === 'passphrase' ? (
            <label className="flex flex-col gap-2">
              <span className="text-caption text-ink-2">
                Passphrase (optional)
              </span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Leave blank for a plain file"
                className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
              />
            </label>
          ) : (
            <RecoveryPhrase
              value={phrase}
              onChange={(next) => {
                setPhrase(next);
                void phraseIsUsable(next).then(setPhraseGood);
              }}
            />
          )}

          <p className="text-caption text-ink-2">
            Either way the file is scrambled so only you can open it. There is no way to recover
            it if you lose what opens it, not by us and not by anyone. Without either you get a
            plain SQLite file that anything can read, which is the right choice if you are moving
            it into a spreadsheet.
          </p>

          {problem && (
            <p className="text-caption text-caution" role="alert">
              {problem}
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" block disabled={busy} onClick={() => void doExport(null)}>
              Plain file
            </Button>
            <Button
              variant="primary"
              block
              disabled={
                busy ||
                (lockWith === 'passphrase' ? passphrase.trim().length < 8 : !phraseGood)
              }
              onClick={() =>
                void doExport(lockWith === 'passphrase' ? passphrase.trim() : phrase.trim())
              }
            >
              {busy ? 'Saving…' : 'Lock it and save'}
            </Button>
          </div>
          {lockWith === 'passphrase' &&
            passphrase.trim().length > 0 &&
            passphrase.trim().length < 8 && (
              <p className="text-caption text-ink-3">
                A passphrase needs at least eight characters to be worth having.
              </p>
            )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title="Restore from a file"
        description="This replaces everything currently in Sovereign on this device."
      >
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-caption text-ink">{restoring?.name}</p>

          <label className="flex flex-col gap-2">
            <span className="text-caption text-ink-2">
              Passphrase
            </span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Only if the file was locked"
              className="w-full rounded-md border border-line bg-raised px-3.5 py-3 text-body text-ink placeholder:text-ink-3"
            />
          </label>

          <p className="text-caption text-caution">
            Everything currently recorded on this device will be replaced by what is in this
            file. If you have anything here you want to keep, export it first.
          </p>

          {problem && (
            <p className="text-caption text-caution" role="alert">
              {problem}
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setRestoring(null)}>
              Cancel
            </Button>
            <Button variant="primary" block disabled={busy} onClick={() => void doRestore()}>
              {busy ? 'Restoring…' : 'Replace everything'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </Card>
  );
}

/* --- the lock ------------------------------------------------------------- */

function LockCard() {
  const [method, setMethod] = useState<LockMethod>(lockMethod());
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [passcode, setPasscodeText] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void biometricsAvailable().then(setCanUseBiometrics);
  }, []);

  const valid = /^\d{6}$/.test(passcode) && passcode === confirm;

  async function save(withBiometrics: boolean) {
    if (!valid) return;
    setBusy(true);
    setProblem(null);
    try {
      if (withBiometrics) await setUpBiometrics(passcode);
      else await setPasscode(passcode);
      setMethod(lockMethod());
      setSettingUp(false);
      setPasscodeText('');
      setConfirm('');
      toast('Sovereign will ask for this when you come back to it.');
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : 'That did not work, so nothing has changed.',
      );
    }
    setBusy(false);
  }

  return (
    <Card label="Locking Sovereign">
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-2">{LOCK_EXPLANATION}</p>

        <p className="text-caption text-ink-3">
          {method === 'none'
            ? 'No lock at the moment. Anyone who picks up this device can open Sovereign.'
            : method === 'biometric'
              ? 'Your face or fingerprint opens Sovereign, with your passcode as a fallback.'
              : 'A six-digit passcode opens Sovereign.'}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={() => setSettingUp(true)}>
            {method === 'none' ? 'Set a passcode' : 'Change it'}
          </Button>
          {method !== 'none' && (
            <>
              <Button variant="secondary" size="sm" onClick={lockNow}>
                Lock now
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  removeLock();
                  setMethod('none');
                  toast('The lock is off. Sovereign will open straight away from now on.');
                }}
              >
                Turn it off
              </Button>
            </>
          )}
        </div>
      </div>

      <BottomSheet
        open={settingUp}
        onClose={() => setSettingUp(false)}
        title="Choose a passcode"
        description="Six digits. Sovereign checks it without ever storing it."
      >
        <div className="flex flex-col gap-4 pb-2">
          <PasscodeField label="Passcode" value={passcode} onChange={setPasscodeText} />
          <PasscodeField label="Again, to be sure" value={confirm} onChange={setConfirm} />

          {confirm.length === 6 && passcode !== confirm && (
            <p className="text-caption text-caution" role="alert">
              Those two do not match. Try again.
            </p>
          )}
          {problem && (
            <p className="text-caption text-caution" role="alert">
              {problem}
            </p>
          )}

          <p className="text-caption text-ink-3">
            There is no way to reset this. Sovereign has no server and no account, so nobody can
            let you back in. Keep an export somewhere safe.
          </p>

          <div className="flex flex-col gap-2">
            {canUseBiometrics && (
              <Button
                variant="primary"
                block
                disabled={!valid || busy}
                onClick={() => void save(true)}
              >
                {busy ? 'Setting up…' : 'Use face or fingerprint too'}
              </Button>
            )}
            <Button
              variant={canUseBiometrics ? 'secondary' : 'primary'}
              block
              disabled={!valid || busy}
              onClick={() => void save(false)}
            >
              {busy ? 'Setting up…' : 'Just the passcode'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </Card>
  );
}

function PasscodeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-caption text-ink-2">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className={clsx(
          'w-full rounded-md border border-line bg-raised px-3.5 py-3 text-lead text-ink tnum',
          'tracking-[0.4em]',
        )}
      />
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One of the two ways to lock an export. */
function LockChoice({
  selected,
  onClick,
  title,
  detail,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={
        'flex flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors ' +
        (selected
          ? 'border-liquid-dim bg-liquid-wash'
          : 'border-line bg-raised hover:border-line-strong')
      }
    >
      <span className={selected ? 'text-body text-liquid' : 'text-body text-ink'}>{title}</span>
      <span className="text-caption text-ink-3">{detail}</span>
    </button>
  );
}
