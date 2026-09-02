import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidate, resetBus, subscribe } from './bus';

beforeEach(() => resetBus());

describe('the invalidation bus', () => {
  it('wakes a listener when a table it watches changes', () => {
    const listener = vi.fn();
    subscribe(['postings'], listener);
    invalidate(['postings']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('leaves listeners on other tables alone', () => {
    const listener = vi.fn();
    subscribe(['accounts'], listener);
    invalidate(['postings']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('runs a listener once even when several of its tables change', () => {
    // One write touches entries and postings; a query reading both must not
    // re-run twice and fire two overlapping reads.
    const listener = vi.fn();
    subscribe(['entries', 'postings'], listener);
    invalidate(['entries', 'postings']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops calling a listener after it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(['postings'], listener);
    unsubscribe();
    invalidate(['postings']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps other listeners on a table when one unsubscribes', () => {
    const staying = vi.fn();
    const leaving = vi.fn();
    subscribe(['postings'], staying);
    const unsubscribe = subscribe(['postings'], leaving);
    unsubscribe();
    invalidate(['postings']);
    expect(staying).toHaveBeenCalledTimes(1);
    expect(leaving).not.toHaveBeenCalled();
  });
});
