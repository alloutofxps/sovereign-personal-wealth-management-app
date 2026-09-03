/* ===========================================================================
 * WHERE THE MONEY CAME FROM
 * ---------------------------------------------------------------------------
 * Paying by card and paying by cash produce the same FINANCIAL postings but
 * completely different BUDGET postings. Cash leaves, so the money you can
 * spend goes down. A card takes nothing today, so instead cash is reserved
 * against the bill that will arrive.
 *
 * Getting that choice wrong does not unbalance anything. Both versions net to
 * zero in both books, so every invariant passes, every test passes, and the
 * only symptom is that the figures quietly mean something else — spending
 * money that has not moved, and a card bill nobody is saving for.
 *
 * That is precisely what happened: statement import hardcoded `via: 'cash'`
 * for every row, including rows from a credit card. This module exists so the
 * mistake cannot be made again. `fundingFor` derives the funding from the
 * account, so there is no second thing to keep in step, and
 * `assertFundingMatchesAccount` runs inside every builder that takes funding,
 * so a hand-built mismatch throws instead of posting.
 * ======================================================================== */

import { LedgerError, type Funding, type LedgerAccount } from './types';

/**
 * The only sanctioned way to say how something was paid for.
 *
 * The account decides: a card or loan reserves against its bill, anything you
 * hold spends the cash. Callers pass the account and get back funding that
 * cannot disagree with it.
 */
export function fundingFor(account: LedgerAccount): Funding {
  if (account.type === 'LIABILITY') {
    if (!account.paymentEnvelopeId) {
      throw new LedgerError(
        `${account.name} is money you owe, but nothing is set up to save towards its bill. ` +
          `Add a pot for it before recording spending on it.`,
      );
    }
    return { via: 'card', account, paymentEnvelopeId: account.paymentEnvelopeId };
  }

  if (account.type !== 'ASSET') {
    throw new LedgerError(
      `${account.name} is not somewhere money can be paid from. ` +
        `Payments come out of an account you hold, or off a card you owe on.`,
    );
  }

  return { via: 'cash', account };
}

/**
 * Check funding against the account it claims to come from.
 *
 * Called inside the builders, so nothing mismatched can reach storage even if
 * it was assembled by hand rather than through `fundingFor`. The messages are
 * user-facing, like the invariant messages: if one ever surfaces, it should
 * read as a sentence rather than as a stack trace.
 */
export function assertFundingMatchesAccount(account: LedgerAccount, funding: Funding): void {
  if (account.id !== funding.account.id) {
    throw new LedgerError(
      `This payment says it came from ${funding.account.name} but is being recorded ` +
        `against ${account.name}. Those need to be the same account.`,
    );
  }

  if (funding.via === 'card') {
    if (account.type !== 'LIABILITY') {
      throw new LedgerError(
        `${account.name} is money you have, not money you owe, so a payment from it ` +
          `cannot be set aside for a card bill. It should be recorded as cash leaving.`,
      );
    }
    if (!account.paymentEnvelopeId) {
      throw new LedgerError(
        `${account.name} has no pot set up for its bill, so there is nowhere to put ` +
          `the money aside.`,
      );
    }
    if (account.paymentEnvelopeId !== funding.paymentEnvelopeId) {
      throw new LedgerError(
        `The money for this payment is being set aside in the wrong pot. ` +
          `${account.name} saves towards its bill somewhere else.`,
      );
    }
    return;
  }

  // The defect this whole module was written for. Spending on a card takes no
  // cash today, so treating it as cash both overstates what has been spent and
  // leaves the eventual bill unfunded.
  if (account.type === 'LIABILITY') {
    throw new LedgerError(
      `${account.name} is a card or loan, so paying with it does not take any money ` +
        `out today. It needs to be recorded as money set aside for the bill instead.`,
    );
  }

  if (account.type !== 'ASSET') {
    throw new LedgerError(
      `${account.name} is not somewhere money can be paid from. ` +
        `Payments come out of an account you hold, or off a card you owe on.`,
    );
  }
}
