/* Accepting that money you fronted is not coming back.
 *
 * This is the one moment it becomes your spending, so the sheet says exactly
 * that and asks where it should land. It is deliberately a second, quieter
 * action rather than sitting next to "Record payback" — writing something off
 * is a decision, not a tidy-up. */

import { useEffect, useState } from 'react';
import type { AccountId } from '@/core/ledger';
import type { Claim } from '@/data/repositories/claimsRepo';
import { writeOffClaim } from '@/app/ledger/actions';
import { useCategoryPicker } from '@/app/taxonomy/useTaxonomy';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { toast } from '@/app/toast';
import { useMoney } from '@/app/money/useMoney';
import { BottomSheet, Button, Explain, Outcome, OutcomeRow } from '@/design/ui';
import { useExplain } from '@/features/explain/useExplain';

export function WriteOffSheet({
  open,
  onClose,
  claim,
}: {
  open: boolean;
  onClose: () => void;
  claim: Claim | null;
}) {
  const money = useMoney();
  // The whole of what is still out is what this write-off is about to convert
  // into spending, so the two figures the example wants are the same number.
  const explain = useExplain(
    claim ? { claimOutstanding: claim.outstanding } : {},
  );
  const [categoryId, setCategoryId] = useState<AccountId | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategoryId(null);
    setProblem(null);
    setSaving(false);
  }, [open]);

  const picker = useCategoryPicker();
  const category = categoryId ? (picker.byId.get(categoryId) ?? null) : null;

  async function confirm() {
    if (!claim || !category) return;
    setSaving(true);
    setProblem(null);
    try {
      await writeOffClaim(claim, category.categoryId, category.envelopeId, category.name);
      toast(
        `Done. ${money.format(claim.outstanding)} now counts as your own spending on ` +
          `${category.name.toLowerCase()}, in this month.`,
      );
      onClose();
    } catch (error) {
      setProblem(
        error instanceof Error
          ? `That did not save: ${error.message}`
          : 'That did not save. Nothing has changed, so you can try again.',
      );
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={claim ? `Write off what ${claim.counterparty} owes you` : 'Write it off'}
      description="Only do this if you have accepted the money is not coming back."
      footer={
        <div className="flex flex-col gap-2">
          {problem && (
            <p className="text-caption text-caution" role="alert">
              {problem}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={onClose}>
              Keep waiting
            </Button>
            <Button
              variant="primary"
              block
              disabled={!category || saving}
              onClick={() => void confirm()}
            >
              {saving ? 'Saving…' : 'Write it off'}
            </Button>
          </div>
        </div>
      }
    >
      {claim && (
        <div className="flex flex-col gap-5 pb-2">
          <Outcome tone="caution">
            <OutcomeRow label="Still owed to you" value={claim.outstanding} size="lead" />
            <div className="flex items-center justify-between gap-2">
              <p className="text-caption text-ink-2">
                It becomes spending this month, not the month you paid it.
              </p>
              <Explain topic="fronted" label="money you fronted" onOpen={explain.open} />
            </div>
          </Outcome>

          <div className="flex flex-col gap-2">
            <span className="text-caption text-ink-2">
              What should it count as?
            </span>
            <CategoryPicker value={categoryId} onChange={setCategoryId} label="" />
          </div>
        </div>
      )}
      {explain.sheet}
    </BottomSheet>
  );
}
