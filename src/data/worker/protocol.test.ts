import { describe, expect, it } from 'vitest';
import { isWrite, tablesWrittenBy } from './protocol';

/* The invalidation bus is only as good as this: if a write's table is not
 * recognised, the screen silently stops updating. */

describe('isWrite', () => {
  it('recognises reads', () => {
    expect(isWrite('SELECT * FROM accounts')).toBe(false);
    expect(isWrite('  \n select id from postings')).toBe(false);
  });

  it('treats everything else as a write', () => {
    expect(isWrite('INSERT INTO entries (id) VALUES (?)')).toBe(true);
    expect(isWrite('UPDATE accounts SET name = ?')).toBe(true);
    expect(isWrite('DELETE FROM postings WHERE id = ?')).toBe(true);
    expect(isWrite('PRAGMA foreign_keys = ON')).toBe(true);
  });
});

describe('tablesWrittenBy', () => {
  it('finds the table in each write form Drizzle produces', () => {
    expect(tablesWrittenBy('insert into "entries" ("id") values (?)')).toEqual(['entries']);
    expect(tablesWrittenBy('update "accounts" set "name" = ? where "id" = ?')).toEqual(['accounts']);
    expect(tablesWrittenBy('delete from "postings" where "entry_id" = ?')).toEqual(['postings']);
  });

  it('handles insert-or-ignore, which the starter accounts use', () => {
    expect(tablesWrittenBy('insert or ignore into "accounts" ("id") values (?)')).toEqual([
      'accounts',
    ]);
  });

  it('reports every table a batch touches, without repeats', () => {
    const sql = `
      insert into "entries" ("id") values (?);
      insert into "postings" ("id") values (?);
      insert into "postings" ("id") values (?);
    `;
    expect(tablesWrittenBy(sql).sort()).toEqual(['entries', 'postings']);
  });

  it('finds nothing in a read, so a select never invalidates anything', () => {
    expect(tablesWrittenBy('select * from accounts where id = ?')).toEqual([]);
  });
});
