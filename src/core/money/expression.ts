/* ===========================================================================
 * ARITHMETIC IN THE AMOUNT FIELD
 * ---------------------------------------------------------------------------
 * Splitting a bill three ways, adding the tip, doubling the round. People do
 * this arithmetic constantly and every app makes them do it somewhere else,
 * then type the answer back in — which is where the typo comes from.
 *
 * Two rules govern everything below.
 *
 * There is no `eval` and no `Function`, and there never will be. This parses
 * a fixed grammar into a token list, shunts it into postfix, and evaluates it
 * with a stack. Handing a string from a text field to a JavaScript evaluator,
 * in an app holding somebody's entire financial history, is not a shortcut
 * worth taking at any price.
 *
 * And the arithmetic is exact wherever it can be. Amounts are scaled to
 * integer minor units on the way in, so `0.1 + 0.2` is 10 + 20 rather than
 * the famous float. Division is the one operation that cannot stay integral —
 * a third of ten euros is not representable — so it rounds once, half away
 * from zero, at the moment it happens, matching every other rounded figure
 * in this app.
 * ======================================================================== */

import { MoneyError, minor, type Minor } from './minor';

/** A number, an operator, or a bracket. */
type Token =
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'open' }
  | { kind: 'close' };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/** How many minor units in one major one. Amounts are scaled by this. */
const SCALE = 100;

export interface EvaluationResult {
  /** The answer in minor units. */
  value: Minor;
  /** True when the input was a plain number rather than a sum. */
  literal: boolean;
}

export class ExpressionError extends Error {
  override name = 'ExpressionError';
}

/**
 * Break the text into tokens, rejecting anything that is not one.
 *
 * Whitespace is ignored; `×` and `÷` are accepted alongside `*` and `/`
 * because those are the characters on the keys, and a comma is read as a
 * decimal point because half of Europe writes it that way.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const text = input.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');

  let i = 0;
  while (i < text.length) {
    const char = text[i]!;

    if (char >= '0' && char <= '9') {
      let digits = '';
      let seenPoint = false;
      while (i < text.length) {
        const c = text[i]!;
        if (c >= '0' && c <= '9') {
          digits += c;
        } else if ((c === '.' || c === ',') && !seenPoint) {
          seenPoint = true;
          digits += '.';
        } else {
          break;
        }
        i += 1;
      }
      tokens.push({ kind: 'number', value: Number(digits) });
      continue;
    }

    // A decimal point can open a number: ".50" is fifty cents.
    if (char === '.' || char === ',') {
      let digits = '0.';
      i += 1;
      while (i < text.length && text[i]! >= '0' && text[i]! <= '9') {
        digits += text[i];
        i += 1;
      }
      if (digits === '0.') throw new ExpressionError('That is not a number yet.');
      tokens.push({ kind: 'number', value: Number(digits) });
      continue;
    }

    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ kind: 'op', value: char });
      i += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'open' });
      i += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'close' });
      i += 1;
      continue;
    }

    throw new ExpressionError(
      `“${char}” is not something this can work out. Numbers, + − × ÷ and brackets only.`,
    );
  }

  return tokens;
}

/**
 * Infix to postfix, by the shunting-yard algorithm.
 *
 * All four operators are left-associative, which is what everybody expects:
 * `10 - 3 - 2` is 5, not 9.
 */
function toPostfix(tokens: readonly Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];

  for (const token of tokens) {
    if (token.kind === 'number') {
      output.push(token);
      continue;
    }
    if (token.kind === 'op') {
      while (operators.length > 0) {
        const top = operators[operators.length - 1]!;
        if (top.kind !== 'op') break;
        if (PRECEDENCE[top.value]! < PRECEDENCE[token.value]!) break;
        output.push(operators.pop()!);
      }
      operators.push(token);
      continue;
    }
    if (token.kind === 'open') {
      operators.push(token);
      continue;
    }

    // A closing bracket.
    let matched = false;
    while (operators.length > 0) {
      const top = operators.pop()!;
      if (top.kind === 'open') {
        matched = true;
        break;
      }
      output.push(top);
    }
    if (!matched) throw new ExpressionError('There is a closing bracket with nothing to close.');
  }

  while (operators.length > 0) {
    const top = operators.pop()!;
    if (top.kind === 'open') throw new ExpressionError('There is a bracket left open.');
    output.push(top);
  }

  return output;
}

/**
 * Work out what it comes to, in minor units.
 *
 * Every value on the stack is already scaled, so addition and subtraction are
 * exact integer arithmetic. Multiplication of two scaled values would be
 * scaled twice, so it is divided back down once; division is the reverse. Both
 * round half away from zero, once, at the point they happen.
 */
function evaluate(postfix: readonly Token[]): number {
  const stack: number[] = [];

  for (const token of postfix) {
    if (token.kind === 'number') {
      // Scaled here rather than at the end, so the whole calculation runs in
      // integers and the classic float error never gets a chance to appear.
      stack.push(Math.round(token.value * SCALE));
      continue;
    }
    if (token.kind !== 'op') continue;

    const right = stack.pop();
    const left = stack.pop();
    if (right === undefined || left === undefined) {
      throw new ExpressionError('That sum is not finished.');
    }

    switch (token.value) {
      case '+':
        stack.push(left + right);
        break;
      case '-':
        stack.push(left - right);
        break;
      case '*':
        stack.push(roundHalfAway((left * right) / SCALE));
        break;
      case '/':
        if (right === 0) {
          throw new ExpressionError('Nothing can be divided by nothing.');
        }
        stack.push(roundHalfAway((left * SCALE) / right));
        break;
    }
  }

  if (stack.length !== 1) throw new ExpressionError('That sum is not finished.');
  return stack[0]!;
}

/** Half away from zero, the convention every rounded figure here uses. */
function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * The whole journey: text in, minor units out.
 *
 * Refuses a negative answer. An amount field asks how much, and "how much"
 * cannot be less than nothing — the direction is the entry's job, not the
 * number's, which is the same rule the ledger builders enforce.
 */
export function evaluateExpression(input: string): EvaluationResult {
  const trimmed = input.trim();
  if (trimmed === '') throw new ExpressionError('There is nothing to work out yet.');

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new ExpressionError('There is nothing to work out yet.');

  const literal = tokens.length === 1 && tokens[0]!.kind === 'number';
  const result = evaluate(toPostfix(tokens));

  if (result < 0) {
    throw new ExpressionError('That comes to less than nothing, which an amount cannot be.');
  }
  if (!Number.isSafeInteger(result)) {
    throw new MoneyError('That comes to more than this can keep track of exactly.');
  }

  return { value: minor(result), literal };
}

/**
 * Whether the text is a sum rather than a plain figure.
 *
 * The keypad uses this to decide whether to show the working above the total.
 * A bare number needs no explanation; `12.50 + 8` does.
 */
export function isExpression(input: string): boolean {
  return /[+\-*/()×÷]/.test(input.trim());
}

/**
 * What it comes to, or null if it does not come to anything yet.
 *
 * For live display while somebody is still typing, where a half-finished sum
 * is the normal state rather than a mistake and must not raise anything.
 */
export function tryEvaluate(input: string): Minor | null {
  try {
    return evaluateExpression(input).value;
  } catch {
    return null;
  }
}
