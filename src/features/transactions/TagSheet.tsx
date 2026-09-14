/* ===========================================================================
 * PUTTING A LABEL ON, OR TAKING ONE OFF
 * ---------------------------------------------------------------------------
 * One sheet, two jobs, because they are the same list read in two directions:
 * adding offers every tag plus a box to make a new one; removing offers only
 * the tags that are actually on something chosen, so nothing on screen is a
 * button that would do nothing.
 * ======================================================================== */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { MAX_TAG_LENGTH, normaliseTagName, sameTag } from '@/core/taxonomy/tags';
import type { TagRecord } from '@/data/repositories/tagsRepo';
import { BottomSheet, Button, Input } from '@/design/ui';

export function TagSheet({
  mode,
  count,
  tags,
  busy,
  onApply,
  onRemove,
  onClose,
}: {
  mode: 'add' | 'remove' | null;
  count: number;
  /** Every tag when adding; only the ones actually present when removing. */
  tags: TagRecord[];
  busy: boolean;
  onApply: (name: string) => void;
  onRemove: (tag: TagRecord) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (mode !== null) setTyped('');
  }, [mode]);

  const name = normaliseTagName(typed);
  const existing = tags.find((tag) => sameTag(tag.name, name));
  const noun = count === 1 ? 'payment' : 'payments';

  return (
    <BottomSheet
      open={mode !== null}
      onClose={onClose}
      title={
        mode === 'remove'
          ? `Take a tag off ${count} ${noun}`
          : `Tag ${count} ${noun}`
      }
      description={
        mode === 'remove'
          ? 'Only the tags actually on them are listed. The payments themselves are not touched.'
          : 'A tag is a label you can search for later. It changes no figure and no budget.'
      }
    >
      {mode === 'remove' ? (
        <div className="flex flex-col gap-2 pb-2">
          {tags.length === 0 ? (
            <p className="py-4 text-body text-ink-2">
              None of the ones you have chosen carries a tag, so there is nothing to take off.
            </p>
          ) : (
            tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                disabled={busy}
                onClick={() => onRemove(tag)}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-raised px-3.5 py-3 text-left [@media(hover:hover)]:hover:border-line-strong disabled:opacity-50"
              >
                <span className="truncate text-body text-ink">{tag.name}</span>
                <span className="shrink-0 text-caption text-ink-3">Take it off</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <Input
            label="A new tag"
            type="text"
            value={typed}
            maxLength={MAX_TAG_LENGTH}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name !== '' && !busy) onApply(name);
            }}
            placeholder="Italy 2026, kitchen, Sam owes half…"
          />

          {existing && (
            <p className="text-caption text-ink-2">
              You already have {existing.name}. This will add to it rather than make a second one.
            </p>
          )}

          <Button
            variant="primary"
            block
            disabled={name === '' || busy}
            onClick={() => onApply(name)}
          >
            {busy ? 'Tagging…' : existing ? `Use ${existing.name}` : `Tag them as ${name || '…'}`}
          </Button>

          {tags.length > 0 && (
            <div className="flex flex-col gap-2 pt-1">
              <span className="text-caption text-ink-2">
                Or one you already use
              </span>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onApply(tag.name)}
                    className={clsx(
                      'rounded-pill border border-line bg-raised px-3 py-1.5 text-caption text-ink',
                      '[@media(hover:hover)]:hover:border-line-strong disabled:opacity-50',
                    )}
                  >
                    {tag.name}
                    <span className="pl-1.5 text-ink-3">{tag.usedOn}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
