/* Chapter 2 — why there are two sets of books, and why both always balance. */

import { useMemo, useState } from 'react';
import { minor, type Minor } from '@/core/money';
import {
  accountId,
  assign,
  cardPayment,
  entryId,
  income,
  isoDate,
  spend,
  transfer,
  type JournalEntry,
  type LedgerAccount,
  type Posting,
} from '@/core/ledger';
import { SYSTEM_ACCOUNTS } from '@/data/seed';
import { useMoney } from '@/app/money/useMoney';
import { Aside, Formula, Heading, Lab, Ledger, Passage, Points, Switch } from '../parts';

export function TwoBooksChapter() {
  return (
    <>
      <Passage>
        Underneath everything Sovereign shows you there are two separate sets of books, and every
        single thing that happens to your money is written into both at once.
      </Passage>

      <Passage>
        The first is the one an accountant would recognise. It records where money physically is:
        what left the current account, what the card now owes, what the shares are worth. It is
        the book that answers "what am I worth?".
      </Passage>

      <Passage>
        The second records what your money is <em>for</em>. Not where it sits, but which job you
        have given it: groceries, rent, the car insurance fund, the not-yet-decided pile. It is
        the book that answers "can I afford this?".
      </Passage>

      <Aside>
        Most budgeting apps keep only the second and bolt a balance onto the side of it. That is
        why they can tell you a category is empty while your account is full, and have no way to
        explain the contradiction. Here the two are the same event written twice, so they cannot
        disagree.
      </Aside>

      <Heading>Both sides, every time</Heading>

      <Passage>
        Inside each book, every entry has to add up to nothing. Money is never created or
        destroyed by recording it. It moves from one place to another, so one line goes up and
        another goes down by exactly the same amount. Debits are written positive here and credits
        negative, which is why every column below totals zero.
      </Passage>

      <Formula>
        {`For every entry, in each book separately:

    Σ debits  +  Σ credits  =  0`}
      </Formula>

      <Passage>
        This is not bookkeeping for its own sake. It is the only reason the app can promise that
        the figures agree: if a bug ever wrote one side of a transaction and not the other, the
        sum stops being zero and the entry is refused before it is saved. There is no state in
        which the books are half-updated.
      </Passage>

      <TwoBooksLab />

      <Heading>What each one is doing</Heading>

      <Points
        items={[
          <>
            <strong className="font-medium text-ink">Money arriving</strong> raises your account
            in the first book, and lands in "ready to be given a job" in the second. Income is not
            budgeted until you say what it is for.
          </>,
          <>
            <strong className="font-medium text-ink">Giving money a job</strong> touches only the
            second book. Nothing has moved in the real world. The money is in the same account it
            was in a second ago, so the first book has nothing to record.
          </>,
          <>
            <strong className="font-medium text-ink">Spending by card</strong> is the interesting
            one. No cash leaves, so the first book raises what the card owes. But the second book
            takes it out of your groceries envelope and puts the same amount into the card's own
            pot, so the money to pay the eventual bill is set aside the moment you spend it.
          </>,
          <>
            <strong className="font-medium text-ink">Paying the card bill</strong> touches no
            expense account at all. The spending was counted when it happened; counting it again
            when you settle it would double every purchase you have ever made on a card.
          </>,
          <>
            <strong className="font-medium text-ink">Moving money between accounts</strong> is
            invisible to the second book when both accounts are on-budget. You have not changed
            what any of it is for.
          </>,
        ]}
      />
    </>
  );
}

/* ===========================================================================
 * THE LAB
 * ---------------------------------------------------------------------------
 * Real builders, real postings. The accounts are invented but they are proper
 * `LedgerAccount` values, because the builders read `type`, `onBudget` and
 * `paymentEnvelopeId` to decide what to write — a simplified stand-in would
 * produce a diagram of what the ledger does rather than what it does.
 * ======================================================================== */

/*
 * The household's real system accounts, not a stand-in.
 *
 * They are already in the first bundle — `actions.ts` uses the same constant
 * for every entry the app writes — so borrowing them here costs nothing and
 * means the lab cannot drift out of step with what actually gets recorded.
 */
const SYSTEM = SYSTEM_ACCOUNTS;

const NAMES = new Map<string, string>([
  [SYSTEM.readyToAssign, 'Not yet given a job'],
  [SYSTEM.budgetableCash, 'Budgetable cash'],
  ['acc-current', 'Current account'],
  ['acc-savings', 'Savings'],
  ['acc-visa', 'Visa'],
  ['env-food', 'Food shopping'],
  ['env-visa', "Visa's own pot"],
  ['cat-food', 'Food shopping'],
  ['src-work', 'Pay from work'],
]);

function account(over: Partial<LedgerAccount> & Pick<LedgerAccount, 'id' | 'type'>): LedgerAccount {
  return {
    book: over.book ?? (over.type === 'ENVELOPE' ? 'BUDGET' : 'FINANCIAL'),
    name: NAMES.get(over.id) ?? over.id,
    normal: over.type === 'ASSET' ? 'DEBIT' : 'CREDIT',
    parentId: null,
    status: 'active',
    onBudget: true,
    liquid: true,
    paymentEnvelopeId: null,
    envelopeRole: null,
    ...over,
  } as LedgerAccount;
}

const CURRENT = account({ id: accountId('acc-current'), type: 'ASSET' });
const SAVINGS = account({ id: accountId('acc-savings'), type: 'ASSET' });
const VISA = account({
  id: accountId('acc-visa'),
  type: 'LIABILITY',
  liquid: false,
  paymentEnvelopeId: accountId('env-visa'),
});

const AMOUNT: Minor = minor(4_250);

type Scene = 'income' | 'assign' | 'card' | 'cash' | 'bill' | 'move';

const SCENES: { value: Scene; label: string }[] = [
  { value: 'income', label: 'Pay arrives' },
  { value: 'assign', label: 'Give it a job' },
  { value: 'cash', label: 'Spend, by card-free cash' },
  { value: 'card', label: 'Spend, on the card' },
  { value: 'bill', label: 'Pay the card bill' },
  { value: 'move', label: 'Move to savings' },
];

const EXPLAINS: Record<Scene, string> = {
  income:
    'The account goes up, and the same amount arrives in the pile that has not been given a job yet.',
  assign:
    'Nothing moved in the real world, so the first book has nothing to say. Only the second one changes.',
  cash: 'Cash left the account, so both books move: what you own goes down, and so does the envelope.',
  card: 'No cash moved. What you owe went up, and the envelope emptied into the card’s own pot, so the bill is already covered.',
  bill: 'Cash leaves and the debt shrinks. No expense is recorded, because the spending was counted when it happened.',
  move: 'Two accounts you own, both on budget. What the money is for has not changed, so the second book is silent.',
};

function build(scene: Scene): JournalEntry {
  const base = { id: entryId(`manual-${scene}`), date: isoDate('2026-09-14') };

  switch (scene) {
    case 'income':
      return income({
        ...base,
        amount: AMOUNT,
        sourceId: accountId('src-work'),
        depositAccountId: CURRENT.id,
        countsAsBudgetableCash: true,
        payer: 'work',
        system: SYSTEM,
      });
    case 'assign':
      return assign({
        ...base,
        amount: AMOUNT,
        envelopeId: accountId('env-food'),
        envelopeName: 'Food shopping',
        system: SYSTEM,
      });
    case 'cash':
      return spend({
        ...base,
        amount: AMOUNT,
        categoryId: accountId('cat-food'),
        envelopeId: accountId('env-food'),
        funding: { via: 'cash', account: CURRENT },
        payee: 'Albert Heijn',
        system: SYSTEM,
      });
    case 'card':
      return spend({
        ...base,
        amount: AMOUNT,
        categoryId: accountId('cat-food'),
        envelopeId: accountId('env-food'),
        funding: { via: 'card', account: VISA, paymentEnvelopeId: accountId('env-visa') },
        payee: 'Albert Heijn',
        system: SYSTEM,
      });
    case 'bill':
      return cardPayment({
        ...base,
        amount: AMOUNT,
        cardAccountId: VISA.id,
        cardName: 'Visa',
        fromAccountId: CURRENT.id,
        fromName: 'Current account',
        paymentEnvelopeId: accountId('env-visa'),
        system: SYSTEM,
      });
    case 'move':
      return transfer({
        ...base,
        amount: AMOUNT,
        from: { accountId: CURRENT.id, name: CURRENT.name, countsAsBudgetableCash: true },
        to: { accountId: SAVINGS.id, name: SAVINGS.name, countsAsBudgetableCash: true },
        system: SYSTEM,
      });
  }
}

function TwoBooksLab() {
  const money = useMoney();
  const [scene, setScene] = useState<Scene>('card');

  const entry = useMemo(() => build(scene), [scene]);

  const books = useMemo(() => {
    const byBook = (book: 'FINANCIAL' | 'BUDGET') =>
      entry.postings.filter((posting: Posting) => posting.book === book);

    return (['FINANCIAL', 'BUDGET'] as const).map((book) => {
      const rows = byBook(book);
      const total = rows.reduce((sum, row) => sum + row.amount, 0);
      return {
        book: book === 'FINANCIAL' ? 'What you own and owe' : 'What it is for',
        rows: rows.map((row) => ({
          account: NAMES.get(row.accountId) ?? row.accountId,
          amount: `${row.amount >= 0 ? '' : '−'}${money.format(minor(Math.abs(row.amount)))}`,
          debit: row.amount >= 0,
        })),
        total: money.format(minor(total)),
        balanced: total === 0,
      };
    });
  }, [entry, money]);

  return (
    <Lab title="One event, written into both books" engine="core/ledger/entries/builders">
      <Switch label="What happened" value={scene} options={SCENES} onChange={setScene} />

      <p className="text-body text-ink">{EXPLAINS[scene]}</p>

      <Ledger books={books} />

      <p className="text-caption text-ink-3">
        {money.format(AMOUNT)}, recorded as “{entry.description}”. Positive is a debit, negative a
        credit. A book with nothing in it is a book that had nothing to record.
      </p>
    </Lab>
  );
}
