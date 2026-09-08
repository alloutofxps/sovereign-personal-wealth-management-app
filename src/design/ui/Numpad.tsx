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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  currencyDisplayName,
  minor,
  minorUnitExponent,
  toDecimalString,
  type CurrencyCode,
  type Minor,
} from '@/core/money';
import {
  DEFAULT_MAX_DIGITS,
  appendDigit,
  appendZeros,
  negate,
  removeLastDigit,
} from '@/core/money/keypad';
// Deep import on purpose: see the note in the money barrel.
import { tryEvaluate } from '@/core/money/expression';
import { useMoney } from '@/app/money/useMoney';
import { useAppConfig } from '@/app/config/store';
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
  /**
   * Show the four operator keys, so a bill can be split where it is entered.
   *
   * Off by default. A keypad asking for one figure — a credit limit, a target —
   * has nothing to work out, and four extra keys would be four extra things to
   * read past.
   */
  allowMath?: boolean;
  /** The working so far, reported up so the readout can show it. */
  onWorkingChange?: (working: string) => void;
  /** Whether the term being typed is money or a plain count. */
  onTermChange?: (term: 'amount' | 'count') => void;
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
  allowMath = false,
  onWorkingChange,
  onTermChange,
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

  /**
   * The part of the sum already committed: "45.20 + ", say.
   *
   * The digits being typed right now stay in `current` as an ordinary amount,
   * so every existing behaviour — the ref, the overflow guard, the backspace —
   * works exactly as it did. Only when an operator is pressed does the figure
   * move into this string and the entry start again.
   */
  const [working, setWorking] = useState('');

  /**
   * Whether the term being typed is money or a count.
   *
   * Money is entered from the right — "4 5 5 0" is 45.50 — which is exactly
   * right for an amount and exactly wrong for a multiplier: pressing 2 after ×
   * would mean two cents, when nobody has ever meant that. Multiplying money by
   * money is meaningless anyway; you multiply it by a number of things. So × and
   * ÷ switch the next term to whole units, and + and − switch it back.
   */
  const [term, setTerm] = useState<'amount' | 'count'>('amount');

  // How many decimal places this currency has, so a term written into the
  // working reads the way the readout above it does. Yen has none; most have
  // two; a few have three.
  const currency = useAppConfig((state) => state.currencyCode);
  const exponent = minorUnitExponent(currency as CurrencyCode);

  const report = useCallback(
    (next: string) => {
      setWorking(next);
      onWorkingChange?.(next);
    },
    [onWorkingChange],
  );

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
    (digit: number) =>
      emit(
        term === 'count'
          ? countDigit(current.current, digit, maxDigits)
          : appendDigit(current.current, digit, maxDigits),
      ),
    [emit, maxDigits, term],
  );
  const pushDouble = useCallback(
    () => emit(appendZeros(current.current, 2, maxDigits)),
    [emit, maxDigits],
  );
  const backspace = useCallback(() => emit(removeLastDigit(current.current)), [emit]);
  const toggleSign = useCallback(() => emit(negate(current.current)), [emit]);

  /** Commit what is on screen and start the next term. */
  const pushOperator = useCallback(
    (operator: '+' | '−' | '×' | '÷') => {
      const shown = toDecimalString(current.current, exponent);
      report(`${working}${shown} ${operator} `);
      setTerm(operator === '×' || operator === '÷' ? 'count' : 'amount');
      emit(minor(0));
      tick();
    },
    [working, report, emit, exponent],
  );

  /**
   * Work the sum out, and put the answer where the figure was.
   *
   * A sum that does not come out leaves everything exactly as it was rather
   * than clearing it. Somebody one keystroke from finishing should not lose
   * what they typed because they pressed equals a moment early.
   */
  const evaluateNow = useCallback(() => {
    if (working === '') return;
    const answer = tryEvaluate(`${working}${toDecimalString(current.current, exponent)}`);
    if (answer === null) return;
    report('');
    setTerm('amount');
    emit(answer);
    tick();
  }, [working, report, emit, exponent]);

  // Clearing the entry clears the working too, so the pad never keeps half a
  // sum nobody can see the start of.
  useEffect(() => {
    onTermChange?.(term);
  }, [term, onTermChange]);

  useEffect(() => {
    if (value === 0 && lastEmitted.current === null && working !== '') {
      report('');
      setTerm('amount');
    }
  }, [value, working, report]);

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
      } else if (event.key === '-' && allowNegative && !allowMath) {
        event.preventDefault();
        toggleSign();
      } else if (allowMath && (event.key === '=' || event.key === 'Enter')) {
        // Equals first: finishing the sum is what Enter means while one is
        // half-written, and submitting an unevaluated figure would record the
        // last term rather than the answer.
        event.preventDefault();
        if (working !== '') evaluateNow();
        else onSubmit?.();
      } else if (allowMath && ['+', '-', '*', '/'].includes(event.key)) {
        event.preventDefault();
        pushOperator(
          event.key === '+' ? '+' : event.key === '-' ? '−' : event.key === '*' ? '×' : '÷',
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    pushDigit,
    backspace,
    toggleSign,
    onSubmit,
    allowNegative,
    allowMath,
    working,
    evaluateNow,
    pushOperator,
  ]);

  return (
    <div className={clsx('flex flex-col gap-1.5 select-none', className)}>
      {/* A fourth column would shrink every key on a phone, so the operators
          sit in their own row above the pad instead. */}
      {allowMath && (
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Arithmetic">
          {(['+', '−', '×', '÷'] as const).map((operator) => (
            <Key key={operator} onPress={() => pushOperator(operator)} label={OPERATOR_NAMES[operator]} muted>
              <span className="text-lead leading-none">{operator}</span>
            </Key>
          ))}
          <Key onPress={evaluateNow} label="Work it out" muted>
            <span className="text-lead leading-none">=</span>
          </Key>
        </div>
      )}

      <div
        className="grid grid-cols-3 gap-1.5"
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
    </div>
  );
}

/**
 * Build a whole number from keystrokes: 2, then 5, is twenty-five.
 *
 * Held in the same minor-unit type as everything else, scaled up so that a
 * count of 2 is the value 2.00 — which is what it means as a multiplier, and
 * what makes `12.25 × 2.00` come out at 24.50.
 */
function countDigit(currentValue: Minor, digit: number, maxDigits: number): Minor {
  const units = Math.trunc(currentValue / 100);
  const next = units * 10 + digit;
  if (String(next).length > Math.max(1, maxDigits - 2)) return currentValue;
  return minor(next * 100);
}

const OPERATOR_NAMES: Record<'+' | '−' | '×' | '÷', string> = {
  '+': 'Add',
  '−': 'Subtract',
  '×': 'Multiply by',
  '÷': 'Divide by',
};

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

  // The sum so far, shown above the figure while one is being built. The
  // keypad owns it; this only displays it, so the two can never disagree.
  const [working, setWorking] = useState('');

  // Mirrored up from the keypad, so a multiplier is not shown with a currency
  // symbol in front of it. "× €2.00" reads as two euros; it is two of a thing.
  const [term, setTerm] = useState<'amount' | 'count'>('amount');

  return (
    <div className={clsx('flex flex-col gap-5', className)}>
      <div className="flex flex-col items-center gap-1.5 pt-1">
        {label && (
          <span className="text-caption text-ink-3">
            {label}
          </span>
        )}
        {working !== '' && (
          <span className="tnum text-caption text-ink-3" aria-label="Working so far">
            {working}
          </span>
        )}
        <div aria-live="polite" aria-atomic="true">
          {term === 'count' ? (
            <span
              className={clsx(
                'tnum text-anchor font-medium text-ink transition-opacity',
                isEmpty && 'opacity-35',
              )}
            >
              {Math.trunc(numpad.value / 100)}
            </span>
          ) : (
            <Money
              value={numpad.value}
              size="anchor"
              tone={isEmpty ? 'muted' : 'auto'}
              className={clsx('transition-opacity', isEmpty && 'opacity-35')}
            />
          )}
        </div>
        <span className="min-h-4 text-caption text-ink-3">
          {term === 'count'
            ? 'How many. Press = to work it out.'
            : working !== ''
            ? 'Press = to work it out.'
            : (hint ?? `Amounts here are in ${currencyDisplayName(money.currency, money.locale)}.`)}
        </span>
      </div>

      <Numpad {...numpad} onWorkingChange={setWorking} onTermChange={setTerm} />
    </div>
  );
}
