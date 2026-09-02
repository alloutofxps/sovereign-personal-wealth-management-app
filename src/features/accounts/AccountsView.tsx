/* What you have, what you owe, and what is set aside in each pot. */

import { minor, type Minor } from '@/core/money';
import type { LedgerAccount } from '@/core/ledger';
import { useAccounts, useBalances } from '@/app/ledger/useLedger';
import { Card, Money } from '@/design/ui';
import type { AccountBalance } from '@/data/repositories/ledgerRepo';
import type { AccountId } from '@/core/ledger';

export function AccountsView() {
  const accounts = useAccounts();
  const balances = useBalances();

  const all = accounts.data ?? [];
  const amountFor = (id: AccountId): Minor =>
    (balances.data as Map<AccountId, AccountBalance> | undefined)?.get(id)?.presented ?? minor(0);

  const held = all.filter((a) => a.type === 'ASSET' && a.name !== 'Money you are owed');
  const owed = all.filter((a) => a.type === 'LIABILITY');
  const pots = all.filter((a) => a.type === 'ENVELOPE');

  const total = minor(
    held.reduce((s, a) => s + amountFor(a.id), 0) - owed.reduce((s, a) => s + amountFor(a.id), 0),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lead font-medium text-ink">Accounts</h1>
        <p className="text-caption text-ink-2">
          Everything you have, everything you owe, and what each pot is holding.
        </p>
      </header>

      <Card label="What you are worth" accent="liquid">
        <Money value={total} size="figure" tone={total < 0 ? 'deficit' : 'neutral'} />
        <p className="pt-2 text-caption text-ink-2">
          What you have, less what you owe.
        </p>
      </Card>

      <Group title="What you have" accounts={held} amountFor={amountFor} />
      {owed.length > 0 && <Group title="What you owe" accounts={owed} amountFor={amountFor} />}
      <Group
        title="Your pots"
        accounts={pots}
        amountFor={amountFor}
        empty="You have not put money into any pots yet."
      />
    </div>
  );
}

function Group({
  title,
  accounts,
  amountFor,
  empty,
}: {
  title: string;
  accounts: LedgerAccount[];
  amountFor: (id: AccountId) => Minor;
  empty?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-ink-3">{title}</h2>
      <Card padding="none">
        {accounts.length === 0 ? (
          <p className="px-4 py-5 text-caption text-ink-2">{empty ?? 'Nothing here yet.'}</p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {accounts.map((account) => {
              const value = amountFor(account.id);
              return (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <span className="min-w-0 truncate text-body text-ink">{account.name}</span>
                  <Money
                    value={value}
                    size="lead"
                    tone={value < 0 ? 'deficit' : 'neutral'}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
