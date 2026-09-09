/* ===========================================================================
 * CHOOSING A CATEGORY
 * ---------------------------------------------------------------------------
 * One picker, used by the entry sheet, the review queue and the write-off
 * sheet, reading the live chart of accounts rather than a literal.
 *
 * It is a grouped `<select>` rather than a grid of buttons. A grid was fine
 * for the eight categories that used to be hardcoded and falls apart at the
 * thirty a real household ends up with; the native control also opens the
 * platform's own picker on a phone, which is faster to use one-handed than
 * anything we would build.
 * ======================================================================== */

import { useEffect, useRef } from 'react';
import type { AccountId } from '@/core/ledger';
import type { ExplainTopic } from '@/content/explain';
import { describePrediction } from '@/core/taxonomy/merchantMemory';
import { useCategoryPicker, useMerchantPrediction } from '@/app/taxonomy/useTaxonomy';
import { Explain, Select } from '@/design/ui';

export function CategoryPicker({
  value,
  onChange,
  label = 'What was it for?',
  /** When given, a hint appears saying how this merchant is usually filed. */
  merchant,
  onPrediction,
}: {
  value: AccountId | null;
  onChange: (categoryId: AccountId) => void;
  label?: string;
  merchant?: string;
  /** Fires when a prediction arrives, so a caller can pre-select it. */
  onPrediction?: (categoryId: AccountId, envelopeId: AccountId) => void;
}) {
  const picker = useCategoryPicker();
  const prediction = useMerchantPrediction(merchant ?? '');

  // Only ever a hint. The caller decides whether to act on it, because
  // silently changing a choice somebody already made is worse than not
  // suggesting anything.
  const guess = prediction.data ?? null;

  // Announced from an effect rather than during render — telling a parent to
  // change state mid-render is how React ends up warning about updating one
  // component while rendering another. The ref keeps it to once per merchant,
  // so a re-render cannot re-apply a suggestion somebody has just overridden.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!guess || !onPrediction) return;
    const key = `${merchant ?? ''}|${guess.categoryId}`;
    if (announced.current === key) return;
    announced.current = key;
    onPrediction(guess.categoryId as AccountId, guess.envelopeId as AccountId);
  }, [guess, merchant, onPrediction]);

  return (
    <div className="flex flex-col gap-2">
      <Select
        label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value as AccountId)}
        groups={picker.groups}
        placeholder="Pick a category"
        emptyLabel={
          picker.ready
            ? 'No categories yet. Add one in Settings'
            : 'Loading your categories…'
        }
      />
      {guess && (
        <p className="text-caption text-ink-3">{describePrediction(guess)}</p>
      )}
    </div>
  );
}

/**
 * "Always file this shop here."
 *
 * Deliberately a plain checkbox rather than anything clever: it is offered at
 * the moment somebody has just made the decision by hand, which is the only
 * moment they actually know the answer.
 */
export function AlwaysFileToggle({
  merchant,
  categoryName,
  checked,
  onChange,
  onExplain,
}: {
  merchant: string;
  categoryName: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /**
   * Opens the explanation of what a filing rule does.
   *
   * Taken as a prop rather than hosted here: this renders inside a sheet that
   * already owns an explanation host, and a second host would mean two sheets
   * competing to be the one on top.
   *
   * Typed as the host's own opener rather than narrowed to `'rules'`: the host
   * accepts any topic, and a narrower parameter type is the wrong way round for
   * a callback — it would refuse the very function that can satisfy it.
   */
  onExplain?: (topic: ExplainTopic) => void;
}) {
  const trimmed = merchant.trim();
  if (!trimmed || !categoryName) return null;

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-raised px-3.5 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-liquid)]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-ink">
          Always file &ldquo;{trimmed}&rdquo; as {categoryName.toLowerCase()}
        </span>
        <span className="text-caption text-ink-3">Only from now on. Nothing already recorded moves.</span>
      </span>
      {/*
        * A span, not the label's own child action.
        *
        * Anything clickable inside a `<label>` still toggles the input it is
        * bound to, so the information button has to stop the event before the
        * label sees it — otherwise reading about the rule switches it on.
        */}
      {onExplain && (
        <span
          className="shrink-0"
          onClick={(event) => event.preventDefault()}
        >
          <Explain topic="rules" label="filing things for you" onOpen={onExplain} />
        </span>
      )}
    </label>
  );
}
