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
import { BottomSheet, Button, Money } from '@/design/ui';

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
          <div className="flex flex-col gap-2 rounded-md border border-caution-dim/50 bg-caution-wash px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-caption text-ink-2">Still owed to you</span>
              <Money value={claim.outstanding} size="lead" tone="caution" />
            </div>
            <p className="text-caption text-ink-2">
              Up to now this has been kept out of your spending, because you expected it back.
              Writing it off means it finally counts as money you spent, this month, not the
              month you paid it, so a month you have already looked at is left alone.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-micro font-medium uppercase tracking-[0.12em] text-ink-3">
              What should it count as?
            </span>
            <CategoryPicker value={categoryId} onChange={setCategoryId} label="" />
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
