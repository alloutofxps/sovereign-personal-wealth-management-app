/* ===========================================================================
 * <Numpad> and <AmountInput>
 * ---------------------------------------------------------------------------
 * Money is never entered through an <input type="number">. The OS keyboard
 * resizes the visual viewport when it opens, which shifts the layout under the
 * user's thumb mid-tap — the exact failure the brief calls out. An in-app
 * keypad removes the cause rather than compensating for it.
 *
 * Entry is point-of-sale style: digits accumulate from the right, so "1 2 3 4"
 * is 12.34 in a two-decimal currency and 1,234 in a zero-decimal one. There is
 * no decimal key to mis-tap, no parse step, and no invalid intermediate state
 * — the value is a valid Minor after every keystroke.
 * ======================================================================== */

import clsx from 'clsx';
import { useCallback, useEffect, useRef } from 'react';
import { currencyDisplayName, type Minor } from '@/core/money';
import {
  DEFAULT_MAX_DIGITS,
  appendDigit,
  appendZeros,
  negate,
  removeLastDigit,
} from '@/core/money/keypad';
import { useMoney } from '@/app/money/useMoney';
import { Money } from './Money';

export interface NumpadProps {
  value: Minor;
  onChange: (value: Minor) => void;
  /** Fired by the physical Enter key; the submit button lives in the footer. */
  onSubmit?: () => void;
  /** Guards against overflow and absurd entries. Counts all digits. */
  maxDigits?: number;
  /** Show a key that flips the sign, for corrections and refunds. */
  allowNegative?: boolean;
  className?: string;
}

const HAPTIC_MS = 8;

function tick() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate?.(HAPTIC_MS);
  }
}

export function Numpad({
  value,
  onChange,
  onSubmit,
  maxDigits = DEFAULT_MAX_DIGITS,
  allowNegative = false,
  className,
}: NumpadProps) {
  /**
   * Keystrokes are applied against a ref rather than the `value` prop.
   *
   * Taps arrive faster than React re-renders, so four quick presses would all
   * read the same pre-burst prop and only the last would survive — "1 2 3 4"
   * entered as 0.04. The ref advances synchronously on every press; the prop
   * still wins whenever the parent changes the value itself (a reset, or
   * loading an existing amount to edit).
   */
  const current = useRef<Minor>(value);
  const lastEmitted = useRef<Minor | null>(null);
  if (value !== lastEmitted.current) current.current = value;

  const emit = useCallback(
    (next: Minor) => {
      if (next === current.current) return;
      current.current = next;
      lastEmitted.current = next;
      tick();
      onChange(next);
    },
    [onChange],
  );

  const pushDigit = useCallback(
    (digit: number) => emit(appendDigit(current.current, digit, maxDigits)),
    [emit, maxDigits],
  );
  const pushDouble = useCallback(
    () => emit(appendZeros(current.current, 2, maxDigits)),
    [emit, maxDigits],
  );
  const backspace = useCallback(() => emit(removeLastDigit(current.current)), [emit]);
  const toggleSign = useCallback(() => emit(negate(current.current)), [emit]);

  // Physical keyboard on desktop. The on-screen pad stays the mobile path.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Never steal a keystroke that belongs to something the user is typing
      // in. Without this, a digit typed into a merchant-name or note field on
      // the same screen would be swallowed by the keypad instead.
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        pushDigit(Number(event.key));
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
      } else if (event.key === 'Enter' && onSubmit) {
        event.preventDefault();
        onSubmit();
      } else if (event.key === '-' && allowNegative) {
        event.preventDefault();
        toggleSign();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pushDigit, backspace, toggleSign, onSubmit, allowNegative]);

  return (
    <div
      className={clsx('grid grid-cols-3 gap-1.5 select-none', className)}
      role="group"
      aria-label="Amount keypad"
    >
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
        <Key key={digit} onPress={() => pushDigit(digit)} label={String(digit)}>
          {digit}
        </Key>
      ))}

      {allowNegative ? (
        <Key onPress={toggleSign} label="Toggle sign" muted>
          <span className="text-figure leading-none">±</span>
        </Key>
      ) : (
        <Key onPress={pushDouble} label="Double zero" muted>
          00
        </Key>
      )}

      <Key onPress={() => pushDigit(0)} label="0">
        0
      </Key>

      <Key onPress={backspace} label="Delete" muted>
        <BackspaceIcon />
      </Key>
    </div>
  );
}

function Key({
  children,
  onPress,
  label,
  muted,
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={clsx(
        'flex h-14 items-center justify-center rounded-md text-figure font-normal tnum',
        'transition-colors duration-75 active:bg-overlay',
        // No hover fill on touch — it sticks after a tap on mobile Safari.
        '[@media(hover:hover)]:hover:bg-raised',
        muted ? 'text-ink-2' : 'text-ink',
      )}
    >
      {children}
    </button>
  );
}

function BackspaceIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="m12 10 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */

export interface AmountInputProps extends Omit<NumpadProps, 'className'> {
  /** Uppercase label above the figure, e.g. "Amount". */
  label?: string;
  /** Contextual line under the figure — an envelope balance, a running total. */
  hint?: string;
  className?: string;
}

/** The keypad with its live readout. Drop into a BottomSheet. */
export function AmountInput({ label, hint, className, ...numpad }: AmountInputProps) {
  const money = useMoney();
  const isEmpty = numpad.value === 0;

  return (
    <div className={clsx('flex flex-col gap-5', className)}>
      <div className="flex flex-col items-center gap-1.5 pt-1">
        {label && (
          <span className="text-micro font-medium uppercase tracking-[0.13em] text-ink-3">
            {label}
          </span>
        )}
        <div aria-live="polite" aria-atomic="true">
          <Money
            value={numpad.value}
            size="anchor"
            tone={isEmpty ? 'muted' : 'auto'}
            className={clsx('transition-opacity', isEmpty && 'opacity-35')}
          />
        </div>
        <span className="min-h-4 text-caption text-ink-3">
          {hint ?? `Amounts here are in ${currencyDisplayName(money.currency, money.locale)}.`}
        </span>
      </div>

      <Numpad {...numpad} />
    </div>
  );
}
