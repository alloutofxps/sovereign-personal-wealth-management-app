/* ===========================================================================
 * ADDING AN ACCOUNT
 * ---------------------------------------------------------------------------
 * Two steps, because the first question decides the answer to most of the
 * others. Once somebody has said "this is a house", there is nothing useful to
 * ask about whether it should count towards safe-to-spend — it should not, and
 * offering the choice invites a mistake that quietly inflates what the app
 * says they can spend.
 *
 * So the second step states what will happen rather than asking. The one
 * override that stays available is taking an everyday account *off* budget,
 * which is a real thing people want — a savings account they would rather not
 * be tempted by — and which is safe in the direction it errs.
 * ======================================================================== */

import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { minor, type Minor, type Rate1e6 } from '@/core/money';
import type { AccountClass } from '@/core/ledger';
// Deep import on purpose: see the note in the ledger barrel.
import { CLASS_PROFILES } from '@/core/ledger/accountClasses';
import { COMMON_CURRENCIES } from '@/core/money';
import { useAppConfig } from '@/app/config/store';
import { createAccount } from '@/data/repositories/accountsRepo';
import { FX_TABLES, latestRates } from '@/data/repositories/fxRepo';
import { useLiveQuery } from '@/data/live/useLiveQuery';
// Deep import on purpose: see the note in the money barrel.
import { formatRate1e6, rateFromDecimal } from '@/core/money/fxReturns';
import { useMoney } from '@/app/money/useMoney';
import { toast } from '@/app/toast';
import { AmountInput, BottomSheet, Button, Input, Select } from '@/design/ui';

/**
 * The five choices, in the order somebody would think of them.
 *
 * Grouped rather than listed flat: eleven classes on one screen is a form, and
 * five familiar words is a question.
 */
const FAMILIES: {
  key: string;
  title: string;
  detail: string;
  classes: { value: AccountClass; label: string }[];
}[] = [
  {
    key: 'cash',
    title: 'Cash and banking',
    detail: 'Current accounts, savings, and money in your pocket.',
    classes: [
      { value: 'checking', label: 'Everyday account' },
      { value: 'savings', label: 'Savings' },
      { value: 'cash', label: 'Cash' },
    ],
  },
  {
    key: 'card',
    title: 'Credit card',
    detail: 'A card you pay off, rather than money you hold.',
    classes: [{ value: 'credit_card', label: 'Credit card' }],
  },
  {
    key: 'debt',
    title: 'Loans and what you owe',
    detail: 'A mortgage, a car loan, anything being paid down.',
    classes: [
      { value: 'mortgage', label: 'Mortgage' },
      { value: 'loan', label: 'Loan' },
    ],
  },
  {
    key: 'invest',
    title: 'Investments and pensions',
    detail: 'Money that is yours but that you would not spend this week.',
    classes: [
      { value: 'brokerage', label: 'Investments' },
      { value: 'retirement', label: 'Pension' },
    ],
  },
  {
    key: 'things',
    title: 'Property and things you own',
    detail: 'A home, a car, anything worth enough to keep track of.',
    classes: [
      { value: 'real_estate', label: 'Property' },
      { value: 'vehicle', label: 'Vehicle' },
      { value: 'other_asset', label: 'Something else' },
    ],
  },
];

export function CreateAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const money = useMoney();
  const baseCurrency = useAppConfig((s) => s.currencyCode);
  const [chosen, setChosen] = useState<AccountClass | null>(null);
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [amount, setAmount] = useState<Minor>(minor(0));
  const [offBudget, setOffBudget] = useState(false);
  const [currency, setCurrency] = useState('');
  const [rateText, setRateText] = useState('');
  const [busy, setBusy] = useState(false);

  /** The chosen currency when it is not the household's own, else null. */
  const foreignCurrency = currency !== '' && currency !== baseCurrency ? currency : null;

  function reset() {
    setChosen(null);
    setName('');
    setInstitution('');
    setAmount(minor(0));
    setOffBudget(false);
    setCurrency('');
    setRateText('');
  }

  function close() {
    reset();
    onClose();
  }

  // Whatever was last recorded for this currency, offered as a starting point
  // rather than imposed. It is almost certainly close and almost certainly not
  // exact, and the person confirming it is the whole point.
  const known = useLiveQuery(
    useCallback(() => latestRates(baseCurrency), [baseCurrency]),
    FX_TABLES,
  );

  useEffect(() => {
    if (!foreignCurrency) {
      setRateText('');
      return;
    }
    const row = (known.data ?? []).find((r) => r.quoteCurrency === foreignCurrency);
    setRateText(row ? formatRate1e6(row.rateScaled) : '');
  }, [foreignCurrency, known.data]);

  const profile = chosen ? CLASS_PROFILES[chosen] : null;
  const owed = profile?.type === 'LIABILITY';
  // An account in another currency is never part of the budget, so the
  // override below stops being offered the moment one is chosen.
  const foreign = foreignCurrency !== null;
  const parsedRate = parseRate(rateText);

  // A foreign balance of nothing needs no rate: there is no figure to convert,
  // so asking for one would be a hurdle in front of an empty account.
  const rateRequired = foreign && amount > 0;
  const rateReady = !rateRequired || parsedRate !== null;

  async function save() {
    if (!chosen || !name.trim()) return;
    setBusy(true);
    try {
      const created = await createAccount({
        name,
        accountClass: chosen,
        startingBalance: amount,
        ...(institution.trim() ? { institution } : {}),
        ...(foreign ? { currency, baseCurrency } : {}),
        ...(foreign && parsedRate !== null ? { rateScaled: parsedRate } : {}),
        ...(profile?.onBudget && offBudget && !foreign ? { onBudget: false } : {}),
      });

      toast(
        created.paymentEnvelopeId
          ? `${name.trim()} is set up, with a pot ready to hold money for its bill.`
          : `${name.trim()} is set up.`,
      );
      close();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That could not be added.', {
        tone: 'attention',
      });
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      open={open}
      onClose={close}
      size="tall"
      title={chosen ? 'A few details' : 'What would you like to add?'}
      {...(chosen
        ? {}
        : {
            description:
              'Everything you own and everything you owe can live here, not just the ' +
              'accounts you spend from.',
          })}
      footer={
        chosen ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setChosen(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              block
              disabled={busy || !name.trim() || !rateReady}
              onClick={() => void save()}
            >
              {busy ? 'Adding…' : 'Add it'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {/* --- step 1: what kind of thing is it? --------------------------- */}
      {!chosen && (
        <div className="flex flex-col gap-3 pb-2">
          {FAMILIES.map((family) => (
            <div
              key={family.key}
              className="flex flex-col gap-2.5 rounded-md border border-line bg-raised px-3.5 py-3"
            >
              <div>
                <p className="text-body text-ink">{family.title}</p>
                <p className="pt-0.5 text-caption text-ink-3">{family.detail}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {family.classes.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setChosen(option.value)}
                    className="rounded-pill border border-line-strong px-3 py-1.5 text-caption text-ink transition-colors hover:border-liquid hover:text-liquid"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- step 2: name it, and say what is in it ---------------------- */}
      {chosen && profile && (
        <div className="flex flex-col gap-4 pb-2">
          <Input
            label="What do you call it?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={owed ? 'Barclays mortgage' : 'Family home'}
            autoFocus
          />

          <Select
            label="Currency"
            value={currency || baseCurrency}
            onChange={(e) => setCurrency(e.target.value === baseCurrency ? '' : e.target.value)}
            options={[
              { value: baseCurrency, label: `${baseCurrency} · what you report in` },
              ...COMMON_CURRENCIES.filter((c) => c !== baseCurrency).map((c) => ({
                value: c,
                label: c,
              })),
            ]}
            {...(foreign
              ? {
                  hint:
                    `Shown in ${currency} first, with what it is worth in ${baseCurrency} ` +
                    `underneath.`,
                }
              : {})}
          />

          {foreign && (
            <Input
              label={`How many ${currency} one ${baseCurrency} buys`}
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              inputMode="decimal"
              placeholder="1.085215"
              hint={
                rateRequired
                  ? `Needed before this can be added: a balance in ${currency} has to be worth ` +
                    `something in ${baseCurrency}, and recording it without a rate would put ` +
                    `the wrong figure into what you are worth.`
                  : `Not needed while the balance is nothing. Add it when there is money in ` +
                    `the account.`
              }
              {...(rateText.trim() !== '' && parsedRate === null
                ? { error: 'A rate looks like 1.085215, a number with up to six decimal places.' }
                : {})}
            />
          )}

          <Input
            label="Who holds it (optional)"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="Your bank, lender, or leave it blank"
          />

          <AmountInput
            value={amount}
            onChange={setAmount}
            label={owed ? 'How much is owed on it' : 'What it is worth today'}
            hint={
              owed
                ? 'What is left to pay. Enter it as a positive number.'
                : 'Your best estimate is fine. You can update it whenever you like.'
            }
          />

          {/* What choosing this will actually do. Stated, not asked. */}
          <div
            className={clsx(
              'rounded-md border px-3.5 py-3',
              profile.onBudget && !offBudget
                ? 'border-liquid/40 bg-liquid-wash/40'
                : 'border-line bg-raised',
            )}
          >
            <p className="text-caption text-ink-2">
              {foreign
                ? `Money in ${currency} is yours and counts towards what you are worth, but it ` +
                  `is not money you can spend on a ${baseCurrency} shop without converting it ` +
                  `first, so it stays out of your budget.`
                : offBudget
                ? 'This will be kept out of your budget. It still counts towards what you ' +
                  'are worth, but nothing here will be treated as money you can spend.'
                : profile.explains}
            </p>
          </div>

          {/* The one override worth offering, and only in the safe direction.
              Not offered on a foreign account: those are never budgeted. */}
          {profile.onBudget && !foreign && (
            <label className="flex items-start gap-3 rounded-md border border-line px-3.5 py-3">
              <input
                type="checkbox"
                checked={offBudget}
                onChange={(e) => setOffBudget(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-liquid)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-body text-ink">Keep this out of my budget</span>
                <span className="text-caption text-ink-3">
                  For savings you would rather not be tempted by. It stays part of what you
                  are worth either way.
                </span>
              </span>
            </label>
          )}

          {amount > 0 && (
            <p className="text-caption text-ink-3">
              {owed
                ? `${money.format(amount)} will be recorded as owed, which comes off what you are worth.`
                : `${money.format(amount)} will be added to what you are worth.`}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * A typed rate, or null when it is not one yet.
 *
 * Six decimal places because that is what the ledger stores; anything finer is
 * a typo rather than precision. Empty is null rather than zero, so an untouched
 * field reads as "not answered" and not as "a rate of nothing".
 */
function parseRate(input: string): Rate1e6 | null {
  const cleaned = input.trim().replace(',', '.');
  if (cleaned === '' || cleaned === '.' || !/^\d*\.?\d{0,6}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return rateFromDecimal(value);
}
