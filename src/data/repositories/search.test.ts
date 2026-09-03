import { describe, expect, it } from 'vitest';
import { toMatchQuery } from './searchRepo';

/* ===========================================================================
 * WHAT GETS HANDED TO FTS5
 * ---------------------------------------------------------------------------
 * FTS5's query language has its own syntax, and a search box hands it whatever
 * somebody typed. An apostrophe, a bare AND, a stray quote or a hyphen are all
 * ordinary things to type into a search box and all meaningful to FTS5, so
 * every token is quoted before it goes anywhere near the engine.
 *
 * The failure this prevents is not a wrong result — it is a thrown error and
 * an empty screen while the person is mid-word.
 * ======================================================================== */

describe('turning typed text into an FTS query', () => {
  it('quotes each word and matches as you type', () => {
    expect(toMatchQuery('tesco')).toBe('"tesco"*');
    expect(toMatchQuery('albert heijn')).toBe('"albert"* "heijn"*');
  });

  it('neutralises the operators FTS5 would otherwise act on', () => {
    // Bare AND/OR/NOT are operators; quoted they are just words.
    expect(toMatchQuery('coffee AND cake')).toBe('"coffee"* "AND"* "cake"*');
    expect(toMatchQuery('NOT shopping')).toBe('"NOT"* "shopping"*');
  });

  it('survives the punctuation people actually type', () => {
    expect(() => toMatchQuery("sam's half")).not.toThrow();
    expect(toMatchQuery("sam's")).toBe('"sam\'s"*');
    // A quote inside a token is escaped by doubling, per FTS5.
    expect(toMatchQuery('say "hi"')).toBe('"say"* """hi"""*');
    expect(toMatchQuery('re-fund')).toBe('"re-fund"*');
  });

  it('collapses whitespace rather than emitting empty tokens', () => {
    expect(toMatchQuery('  spaced   out  ')).toBe('"spaced"* "out"*');
    expect(toMatchQuery('   ')).toBe('');
  });
});
