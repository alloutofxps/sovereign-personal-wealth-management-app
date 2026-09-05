/* ===========================================================================
 * FROM A FILE TO SOMETHING WORTH REVIEWING
 * ---------------------------------------------------------------------------
 * Takes the parsed grid and a column mapping and produces candidate rows,
 * with every row that could not be read reported rather than dropped.
 *
 * A silently skipped row is the worst outcome here: the person believes their
 * statement is in, the totals are quietly wrong, and nothing ever says so.
 * ======================================================================== */

import { normalizePayee } from '@/core/taxonomy/payeeNormalizer';
import type { Minor } from '@/core/money';
import { detectDelimiter, findHeaderRow, guessColumns, parseDelimited, type ColumnRole, type Delimiter } from './csv';
import { dedupeKey, detectDateFormat, parseAmount, parseDate, type DateOrder } from './values';

export interface ColumnMapping {
  date: number;
  description: number;
  /** One signed column, or a debit and credit pair. Never both. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
  dateOrder: DateOrder;
  /** Some banks write outgoings as positive numbers. */
  outflowIsPositive: boolean;
}

export interface ParsedFile {
  delimiter: Delimiter;
  headerRow: number;
  headers: string[];
  rows: string[][];
  /** A first guess at the mapping, which the person can correct. */
  suggested: ColumnMapping;
  /** True when the date order could not be proven from the data. */
  dateIsAmbiguous: boolean;
}

export interface CandidateRow {
  date: string;
  /**
   * What the bank called it, tidied into something recognisable.
   *
   * `SumUp *KOFFIE 0031204 Amsterdam` becomes `Koffie`. This is what the
   * person sees and what rules match on, which is the point: the reference
   * number in the raw string is different on every visit, so a rule written
   * against it would match once and never again.
   */
  description: string;
  /** Exactly what the bank sent, before any tidying. */
  rawDescription: string;
  amount: Minor;
  dedupeKey: string;
  /** The original line, kept so the person can always see what came in. */
  raw: string;
  lineNumber: number;
}

export interface RejectedRow {
  lineNumber: number;
  raw: string;
  /** A complete sentence saying what could not be read. */
  reason: string;
}

export interface ImportResult {
  rows: CandidateRow[];
  rejected: RejectedRow[];
}

/** Read the file far enough to show a mapping screen. */
export function inspectFile(text: string): ParsedFile {
  const delimiter = detectDelimiter(text);
  const all = parseDelimited(text, delimiter).filter((row) => row.some((cell) => cell !== ''));
  const headerRow = findHeaderRow(all);
  const headers = all[headerRow] ?? [];
  const rows = all.slice(headerRow + 1);

  const guesses = guessColumns(headers, rows.slice(0, 30));
  const find = (role: ColumnRole): number | null =>
    guesses.find((g) => g.role === role)?.index ?? null;

  const dateIndex = find('date') ?? 0;
  const dateSample = rows.map((row) => row[dateIndex] ?? '').filter((v) => v !== '');
  const dateFormat = detectDateFormat(dateSample);

  return {
    delimiter,
    headerRow,
    headers,
    rows,
    suggested: {
      date: dateIndex,
      description: find('description') ?? 1,
      amount: find('amount'),
      debit: find('debit'),
      credit: find('credit'),
      dateOrder: dateFormat.order,
      outflowIsPositive: find('amount') === null,
    },
    dateIsAmbiguous: !dateFormat.proven,
  };
}

/** Apply a mapping and produce the rows worth reviewing. */
export function buildCandidates(
  file: ParsedFile,
  mapping: ColumnMapping,
  accountId: string,
  exponent: number,
): ImportResult {
  const rows: CandidateRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  file.rows.forEach((row, index) => {
    const lineNumber = file.headerRow + index + 2; // 1-based, past the header
    const raw = row.join(' · ');
    if (row.every((cell) => cell === '')) return;

    const dateText = row[mapping.date] ?? '';
    const date = parseDate(dateText, mapping.dateOrder);
    if (!date) {
      rejected.push({
        lineNumber,
        raw,
        reason: dateText
          ? `"${dateText}" is not a date Sovereign can read.`
          : 'This line has no date on it.',
      });
      return;
    }

    const amount = readAmount(row, mapping, exponent);
    if (amount === null) {
      rejected.push({ lineNumber, raw, reason: 'This line has no amount on it.' });
      return;
    }
    if (amount === 0) {
      rejected.push({ lineNumber, raw, reason: 'This line is for nothing at all.' });
      return;
    }

    const rawDescription = (row[mapping.description] ?? '').trim() || 'No description';
    const description = normalizePayee(rawDescription) || rawDescription;

    // The key is taken from the raw string, not the tidied one. Two shops that
    // tidy down to the same name are still two different lines on a statement,
    // and collapsing them would silently drop one as a duplicate.
    const key = dedupeKey({ accountId, date, amount, description: rawDescription });

    // A statement can legitimately contain the same coffee twice in a day, so
    // repeats within one file are kept and only flagged against what is
    // already stored. Within the file, a suffix keeps their keys distinct.
    let uniqueKey = key;
    let repeat = 1;
    while (seen.has(uniqueKey)) uniqueKey = `${key}#${++repeat}`;
    seen.add(uniqueKey);

    rows.push({
      date,
      description,
      rawDescription,
      amount,
      dedupeKey: uniqueKey,
      raw,
      lineNumber,
    });
  });

  return { rows, rejected };
}

function readAmount(
  row: readonly string[],
  mapping: ColumnMapping,
  exponent: number,
): Minor | null {
  // Separate debit and credit columns: whichever has a value wins, and the
  // debit is always money leaving whatever the file's sign convention is.
  if (mapping.debit !== null || mapping.credit !== null) {
    const debit = mapping.debit === null ? null : parseAmount(row[mapping.debit] ?? '', exponent);
    const credit = mapping.credit === null ? null : parseAmount(row[mapping.credit] ?? '', exponent);

    if (debit !== null && debit !== 0) return (-Math.abs(debit) as Minor);
    if (credit !== null && credit !== 0) return (Math.abs(credit) as Minor);
    return null;
  }

  if (mapping.amount === null) return null;
  const value = parseAmount(row[mapping.amount] ?? '', exponent);
  if (value === null) return null;

  return (mapping.outflowIsPositive ? (-value as Minor) : value);
}

/** A one-line summary for the screen after an import. */
export function describeImport(result: ImportResult, duplicates: number): string {
  const kept = result.rows.length - duplicates;
  const parts: string[] = [];

  parts.push(
    kept === 0
      ? 'Nothing new to add'
      : `${kept} ${kept === 1 ? 'payment' : 'payments'} ready for you to look at`,
  );
  if (duplicates > 0) {
    parts.push(`${duplicates} ${duplicates === 1 ? 'was' : 'were'} already in Sovereign`);
  }
  if (result.rejected.length > 0) {
    parts.push(
      `${result.rejected.length} ${result.rejected.length === 1 ? 'line' : 'lines'} could not be read`,
    );
  }

  return `${parts.join(', ')}.`;
}
