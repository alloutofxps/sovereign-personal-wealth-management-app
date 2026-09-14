/* ===========================================================================
 * THE LOCK SCREEN AND THE PRIVACY VEIL
 * ---------------------------------------------------------------------------
 * Two related jobs.
 *
 * The veil blurs the whole app the moment the tab is hidden. Phones photograph
 * the screen for the app switcher at exactly that moment, so the blur has to
 * be applied on `visibilitychange` rather than on blur — by the time a blur
 * event fires, the snapshot has been taken.
 *
 * The gate holds the app closed until the passcode or a passkey opens it, and
 * closes it again after a stretch of inactivity.
 * ======================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  LOCK_EXPLANATION,
  lockAfterMinutes,
  lockMethod,
  verifyBiometrics,
  verifyPasscode,
} from '@/app/security/lock';
import { Button } from '@/design/ui';

export function LockGate({ children }: { children: React.ReactNode }) {
  const method = lockMethod();
  const [locked, setLocked] = useState(method !== 'none');
  const [hidden, setHidden] = useState(false);
  const lastActive = useRef(Date.now());

  /* --- the veil ---------------------------------------------------------- */
  useEffect(() => {
    const onVisibility = () => {
      const away = document.visibilityState === 'hidden';
      setHidden(away);

      if (away) {
        lastActive.current = Date.now();
        return;
      }

      // Coming back: lock again if we have been away long enough.
      const minutes = lockAfterMinutes();
      const awayFor = (Date.now() - lastActive.current) / 60_000;
      if (lockMethod() !== 'none' && minutes > 0 && awayFor >= minutes) setLocked(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /* --- locking again on request ------------------------------------------ */
  useEffect(() => {
    const onLockNow = () => setLocked(lockMethod() !== 'none');
    window.addEventListener('sovereign:lock', onLockNow);
    return () => window.removeEventListener('sovereign:lock', onLockNow);
  }, []);

  if (locked) return <LockScreen onUnlocked={() => setLocked(false)} />;

  return (
    <div className={clsx(hidden && 'privacy-veil')} aria-hidden={hidden || undefined}>
      {children}
      {hidden && <span className="sr-only">{LOCK_EXPLANATION}</span>}
    </div>
  );
}

function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const method = lockMethod();
  const [digits, setDigits] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const tryBiometrics = useCallback(async () => {
    setChecking(true);
    setProblem(null);
    if (await verifyBiometrics()) onUnlocked();
    else setProblem('That did not work. You can use your passcode instead.');
    setChecking(false);
  }, [onUnlocked]);

  // Offer the phone's own prompt straight away — that is the fast path.
  useEffect(() => {
    if (method === 'biometric') void tryBiometrics();
  }, [method, tryBiometrics]);

  async function submit(passcode: string) {
    setChecking(true);
    setProblem(null);
    if (await verifyPasscode(passcode)) {
      onUnlocked();
    } else {
      setProblem('That passcode did not work. Try again.');
      setDigits('');
    }
    setChecking(false);
  }

  function press(digit: string) {
    const next = digits + digit;
    setDigits(next);
    if (next.length >= 6) void submit(next);
  }

  return (
    // `fixed inset-0` rather than `min-h-dvh`, matching `Opening` in the
    // shell: this is the whole screen, and `dvh` is a status bar short of it
    // in an iOS home-screen app.
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-base px-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div
          className="flex size-11 items-center justify-center rounded-full bg-raised"
          aria-hidden="true"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="10" width="16" height="10" rx="2" stroke="var(--color-liquid)" strokeWidth="1.6" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="var(--color-liquid)" strokeWidth="1.6" />
          </svg>
        </div>
        <h1 className="text-lead font-medium text-ink">Sovereign is locked</h1>
        <p className="max-w-[32ch] text-caption text-ink-2">
          {method === 'biometric'
            ? 'Use your face or fingerprint, or enter your passcode below.'
            : 'Enter your passcode to carry on.'}
        </p>
      </div>

      <div className="flex gap-2.5" aria-label={`${digits.length} of 6 digits entered`}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span
            key={index}
            className={clsx(
              'size-2.5 rounded-full transition-colors',
              index < digits.length ? 'bg-liquid' : 'bg-line-strong',
            )}
          />
        ))}
      </div>

      {problem && (
        <p className="text-caption text-caution" role="alert">
          {problem}
        </p>
      )}

      <div className="grid w-full max-w-[16rem] grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <PadKey key={digit} onPress={() => press(digit)} disabled={checking}>
            {digit}
          </PadKey>
        ))}
        <PadKey onPress={() => setDigits('')} disabled={checking} muted>
          Clear
        </PadKey>
        <PadKey onPress={() => press('0')} disabled={checking}>
          0
        </PadKey>
        <PadKey onPress={() => setDigits(digits.slice(0, -1))} disabled={checking} muted>
          Back
        </PadKey>
      </div>

      {method === 'biometric' && (
        <Button variant="secondary" onClick={() => void tryBiometrics()} disabled={checking}>
          Use face or fingerprint
        </Button>
      )}
    </div>
  );
}

function PadKey({
  children,
  onPress,
  disabled,
  muted,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={clsx(
        'flex h-14 items-center justify-center rounded-md text-figure tnum',
        'transition-colors active:bg-overlay disabled:opacity-40',
        '[@media(hover:hover)]:hover:bg-raised',
        muted ? 'text-caption text-ink-2' : 'text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Lock the app from anywhere — the button in settings uses this. */
export function lockNow(): void {
  window.dispatchEvent(new Event('sovereign:lock'));
}
