/* ===========================================================================
 * READING A BANK FILE
 * ---------------------------------------------------------------------------
 * Every bank exports something slightly different: commas or semicolons,
 * one amount column or separate debit and credit columns, dates in three
 * different orders, and a few lines of preamble before the real header.
 *
 * All of it is parsed here, in the browser, on the person's own device. The
 * file is never uploaded anywhere — that is the whole point of the product,
 * and it happens to also be the simplest way to build it.
 *
 * Nothing in this file touches the DOM, the network, or the database, so the
 * awkward parts can be tested exhaustively against real-world shapes.
 * ======================================================================== */

export type Delimiter = ',' | ';' | '\t' | '|';

const DELIMITERS: Delimiter[] = [',', ';', '\t', '|'];

/** Split a delimited file into rows, respecting quotes and escaped quotes. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a byte-order mark; several banks emit one and it corrupts the
  // first header name, which then fails to match anything.
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.map((r) => r.map((cell) => cell.trim()));
}

/**
 * Work out which character separates the columns.
 *
 * The right delimiter is the one that gives the most columns *consistently* —
 * a semicolon file split on commas gives one wide column, and a comma file
 * split on semicolons gives the same. Consistency is the tell.
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = text.split('\n').slice(0, 20).join('\n');
  let best: Delimiter = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITERS) {
    const rows = parseDelimited(sample, delimiter).filter((r) => r.length > 0);
    if (rows.length === 0) continue;

    const widths = rows.map((r) => r.length);
    const max = Math.max(...widths);
    if (max < 2) continue;

    const consistent = widths.filter((w) => w === max).length / widths.length;
    const score = max * consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

/**
 * Find the header row.
 *
 * Statements often begin with an account number, a date range and a blank
 * line. The header is the first row that looks like labels rather than data:
 * several non-empty cells, none of which parse as a number.
 */
export function findHeaderRow(rows: readonly string[][]): number {
  for (let index = 0; index < Math.min(rows.length, 25); index++) {
    const row = rows[index]!;
    const filled = row.filter((cell) => cell !== '');
    if (filled.length < 2) continue;

    const numeric = filled.filter((cell) => /^-?[\d.,\s]+$/.test(cell)).length;
    if (numeric === 0) return index;
  }
  return 0;
}

/* --- what each column means ---------------------------------------------- */

export type ColumnRole = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'ignore';

export interface ColumnGuess {
  index: number;
  header: string;
  role: ColumnRole;
  /** 0–1. Below the threshold the mapping screen asks rather than assumes. */
  confidence: number;
}

const PATTERNS: { role: ColumnRole; pattern: RegExp; confidence: number }[] = [
  { role: 'date', pattern: /^(transaction\s*)?date|datum|dato|fecha|booking/i, confidence: 0.95 },
  { role: 'debit', pattern: /debit|withdraw|money\s*out|paid\s*out|af$|uit/i, confidence: 0.9 },
  { role: 'credit', pattern: /credit|deposit|money\s*in|paid\s*in|bij$|in$/i, confidence: 0.9 },
  { role: 'amount', pattern: /amount|bedrag|value|sum|betrag|montant/i, confidence: 0.9 },
  { role: 'balance', pattern: /balance|saldo|running/i, confidence: 0.9 },
  {
    role: 'description',
    pattern: /descri|narrative|details|payee|merchant|reference|memo|name|omschrijving|tegenrekening/i,
    confidence: 0.85,
  },
];

/** A first guess at what each column is, from its header and its contents. */
export function guessColumns(header: readonly string[], sample: readonly string[][]): ColumnGuess[] {
  const guesses: ColumnGuess[] = header.map((name, index) => {
    for (const { role, pattern, confidence } of PATTERNS) {
      if (pattern.test(name)) return { index, header: name, role, confidence };
    }
    return { index, header: name, role: 'ignore' as ColumnRole, confidence: 0 };
  });

  // Where the header says nothing useful, look at what is actually in the
  // column. A column of dates is a date column whatever it is called.
  for (const guess of guesses) {
    if (guess.confidence > 0) continue;
    const values = sample.map((row) => row[guess.index] ?? '').filter((v) => v !== '');
    if (values.length === 0) continue;

    if (values.every((v) => looksLikeDate(v))) {
      guess.role = 'date';
      guess.confidence = 0.7;
    } else if (values.every((v) => looksLikeAmount(v))) {
      guess.role = 'amount';
      guess.confidence = 0.6;
    } else if (values.some((v) => v.length > 8)) {
      guess.role = 'description';
      guess.confidence = 0.5;
    }
  }

  // Only one column can hold each role. Where two claim the same one, the
  // more confident keeps it and the other is left for the person to set.
  for (const role of ['date', 'amount', 'description', 'balance'] as ColumnRole[]) {
    const claimants = guesses
      .filter((g) => g.role === role)
      .sort((a, b) => b.confidence - a.confidence);
    for (const loser of claimants.slice(1)) {
      loser.role = 'ignore';
      loser.confidence = 0;
    }
  }

  return guesses;
}

export function looksLikeDate(value: string): boolean {
  return /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(value.trim());
}

export function looksLikeAmount(value: string): boolean {
  return /^[-+(]?\s*[\d.,\s']+\)?$/.test(value.trim()) && /\d/.test(value);
}
