/* ===========================================================================
 * WHAT EACH KIND OF ACCOUNT IS, AND WHAT CREATING ONE INVOLVES
 * ---------------------------------------------------------------------------
 * Two facts live here, and both are domain knowledge rather than storage
 * detail, which is why they are in the core and not in the repository.
 *
 * The first is what a class *means*: whether it is something you have or
 * something you owe, whether it backs budgetable cash, whether its value can
 * move on its own. Written down once, because the alternative is the same
 * three facts repeated in the creation sheet, the repository and the migration
 * and drifting apart the first time somebody adds a class.
 *
 * The second is what creating one actually requires. A credit card is a card
 * *and* the pot that holds money for its bill; a house is an account *and* a
 * first mark saying what it cost. Deciding that here — as a plain value a test
 * can read — means the pairing can be proved without a database standing by,
 * and the repository is left with nothing to do but carry the plan out.
 * ======================================================================== */

import type { Minor } from '@/core/money';
import {
  BOOK_BY_TYPE,
  LedgerError,
  NORMAL_BY_TYPE,
  type AccountClass,
  type AccountId,
  type DepreciationModel,
  type LedgerAccount,
  type LedgerAccountType,
} from './types';

/** Which of the four sections of the balance sheet a class belongs in. */
export type AccountGroup = 'cash' | 'foreign' | 'investments' | 'property' | 'debts';

export interface ClassProfile {
  type: LedgerAccountType;
  onBudget: boolean;
  liquid: boolean;
  group: AccountGroup;
  /** A complete sentence saying what choosing this will do. Shown as written. */
  explains: string;
  /** Whether marking a new value makes sense for this kind of thing. */
  revaluable: boolean;
}

export const CLASS_PROFILES: Record<AccountClass, ClassProfile> = {
  checking: {
    type: 'ASSET',
    onBudget: true,
    liquid: true,
    group: 'cash',
    explains:
      'Money you could spend today. It counts towards what is safe to spend and towards ' +
      'what you have to give a job.',
    revaluable: false,
  },
  savings: {
    type: 'ASSET',
    onBudget: true,
    liquid: true,
    group: 'cash',
    explains:
      'Money you could spend today if you moved it. It counts towards what is safe to ' +
      'spend, so put some of it aside in a pot if you would rather not touch it.',
    revaluable: false,
  },
  cash: {
    type: 'ASSET',
    onBudget: true,
    liquid: true,
    group: 'cash',
    explains: 'Notes and coins. Counted the same way as money in the bank.',
    revaluable: false,
  },
  credit_card: {
    type: 'LIABILITY',
    onBudget: false,
    liquid: false,
    group: 'debts',
    explains:
      'We will automatically set aside money for this card’s bill when you spend ' +
      'with it, so the bill is already covered when it arrives.',
    revaluable: false,
  },
  loan: {
    type: 'LIABILITY',
    onBudget: false,
    liquid: false,
    group: 'debts',
    explains:
      'What you still owe. It comes off what you are worth, and paying it down is not ' +
      'spending.',
    revaluable: false,
  },
  mortgage: {
    type: 'LIABILITY',
    onBudget: false,
    liquid: false,
    group: 'debts',
    explains:
      'What is left on the mortgage. It comes off what you are worth, and the payments ' +
      'you make against it are not spending.',
    revaluable: false,
  },
  brokerage: {
    type: 'ASSET',
    onBudget: false,
    liquid: false,
    group: 'investments',
    explains:
      'This is a tracking account. It counts towards what you are worth, but it will not ' +
      'change what is safe to spend.',
    revaluable: true,
  },
  retirement: {
    type: 'ASSET',
    onBudget: false,
    liquid: false,
    group: 'investments',
    explains:
      'A pension is yours but not available yet, so it counts towards what you are worth ' +
      'and never towards what is safe to spend.',
    revaluable: true,
  },
  real_estate: {
    type: 'ASSET',
    onBudget: false,
    liquid: false,
    group: 'property',
    explains:
      'This is a tracking account. It counts towards what you are worth, but it will not ' +
      'affect your safe-to-spend cash.',
    revaluable: true,
  },
  vehicle: {
    type: 'ASSET',
    onBudget: false,
    liquid: false,
    group: 'property',
    explains:
      'This is a tracking account. It counts towards what you are worth, and you can let ' +
      'it lose value on its own the way vehicles do.',
    revaluable: true,
  },
  other_asset: {
    type: 'ASSET',
    onBudget: false,
    liquid: false,
    group: 'property',
    explains:
      'This is a tracking account. It counts towards what you are worth, but it will not ' +
      'affect your safe-to-spend cash.',
    revaluable: true,
  },
};

/** How each group is headed on the accounts screen. */
export const GROUP_TITLES: Record<AccountGroup, string> = {
  cash: 'Money in hand',
  foreign: 'Money in other currencies',
  investments: 'Investments and retirement',
  property: 'Property and things you own',
  debts: 'What you owe',
};

export const GROUP_HINTS: Record<AccountGroup, string> = {
  cash: 'Money you could spend today. This is what safe-to-spend is worked out from.',
  foreign:
    'Yours, and counted in what you are worth — but not money you can spend here until ' +
    'you have converted it, so it is left out of safe-to-spend.',
  investments: 'Yours, but not money you would spend this week.',
  property: 'Things you own that are worth something. Tap one to say what it is worth now.',
  debts: 'Cards, loans and anything else that comes off what you are worth.',
};

/**
 * Which section an account belongs under.
 *
 * Money in another currency gets its own, and that is not tidiness. A dollar
 * account sitting under "Money in hand" would be adding to a total whose hint
 * says it is what safe-to-spend is worked out from — and it is not, because it
 * has to be converted first. Somebody reading that heading would be told they
 * can spend money they cannot.
 */
export function groupOf(account: LedgerAccount, baseCurrency?: string): AccountGroup {
  const foreign = Boolean(
    account.currency && (baseCurrency ? account.currency !== baseCurrency : true),
  );

  if (account.accountClass) {
    const group = CLASS_PROFILES[account.accountClass].group;
    return foreign && group === 'cash' ? 'foreign' : group;
  }
  // The three accounts that predate v10 carry no class. Read them from what
  // they already are rather than guessing: they are the originals, and the
  // originals are an everyday account, a savings account and a card.
  if (account.type === 'LIABILITY') return 'debts';
  if (account.onBudget && account.liquid) return 'cash';
  return 'investments';
}

/** Whether marking a new value makes sense for this account. */
export function isRevaluable(account: LedgerAccount): boolean {
  if (account.type !== 'ASSET' || account.onBudget) return false;
  return account.accountClass ? CLASS_PROFILES[account.accountClass].revaluable : false;
}

/* ===========================================================================
 * WHAT CREATING ONE INVOLVES
 * ======================================================================== */

export interface AccountDraft {
  name: string;
  accountClass: AccountClass;
  /**
   * What it is denominated in. Omitted, or equal to the base currency, means
   * ordinary money the household can spend.
   */
  currency?: string | null;
  /** What the household reports in. Needed only to recognise a foreign one. */
  baseCurrency?: string;
  /** Always positive: what it holds, or what is owed on it. */
  startingBalance: Minor;
  institution?: string | null;
  /** Overrides the class default, for somebody who knows their own money. */
  onBudget?: boolean;
  aprBp?: number | null;
  depreciationModel?: DepreciationModel | null;
  depreciationRateBp?: number | null;
  salvageValue?: Minor | null;
}

export interface AccountPlan {
  account: LedgerAccount;
  /**
   * The reserve pot a credit card cannot exist without.
   *
   * Null for everything else. Present here rather than being created by a
   * second call, because a card whose pot creation failed is a card that
   * silently stops setting money aside for its own bill.
   */
  paymentEnvelope: LedgerAccount | null;
  /** Whether a starting figure needs an opening entry written for it. */
  needsOpeningEntry: boolean;
  /** True when the opening figure is something owed rather than something held. */
  opensAsOwed: boolean;
  /** Whether the starting figure should also be recorded as the first mark. */
  needsFirstMark: boolean;
  profile: ClassProfile;
}

/**
 * Work out everything that has to exist for this account, before anything is
 * written down.
 *
 * Pure, and deliberately so: every rule that decides whether a card gets a
 * pot, whether a figure is owed or held, and whether a thing can be revalued
 * is decided here where it can be read and tested, rather than inside a
 * transaction where it can only be observed by running one.
 */
export function planAccountCreation(
  draft: AccountDraft,
  ids: { account: AccountId; paymentEnvelope: AccountId },
): AccountPlan {
  const name = draft.name.trim();
  if (!name) {
    throw new LedgerError('An account needs a name before it can be created.');
  }
  if (draft.startingBalance < 0) {
    throw new LedgerError(
      'A starting figure is always a positive number — what the account holds, or what ' +
        'is owed on it.',
    );
  }

  const profile = CLASS_PROFILES[draft.accountClass];
  if (!profile) {
    throw new LedgerError('That is not a kind of account this app knows about.');
  }

  // An account in another currency is never part of the budget, however
  // everyday it looks. Budgetable cash mirrors on-budget liquid assets exactly
  // (I4), and an account whose worth moves whenever a rate moves cannot hold
  // that mirror still. It is also simply true: dollars are not money you can
  // spend on this week's euro shopping until you have converted them.
  const foreign = Boolean(
    draft.currency && draft.baseCurrency && draft.currency !== draft.baseCurrency,
  );

  if (foreign && draft.onBudget === true) {
    throw new LedgerError(
      `${name} is in ${draft.currency}, so it cannot be part of a budget kept in ` +
        `${draft.baseCurrency}. It will still count towards what you are worth.`,
    );
  }

  const onBudget = foreign ? false : (draft.onBudget ?? profile.onBudget);
  if (onBudget && !profile.liquid) {
    throw new LedgerError(
      `${name} is not money you could spend today, so it cannot be part of your budget. ` +
        `It will still count towards what you are worth.`,
    );
  }

  const type = profile.type;
  const isCard = draft.accountClass === 'credit_card';

  const account: LedgerAccount = {
    id: ids.account,
    book: BOOK_BY_TYPE[type],
    type,
    name,
    normal: NORMAL_BY_TYPE[type],
    parentId: null,
    status: 'active',
    onBudget,
    // Liquid only ever alongside on-budget. The two are read together by I4
    // and by safe-to-spend, and an account that is one but not the other is a
    // shape neither of them expects.
    liquid: onBudget && profile.liquid,
    paymentEnvelopeId: isCard ? ids.paymentEnvelope : null,
    envelopeRole: null,
    accountClass: draft.accountClass,
    currency: draft.currency ?? null,
    institution: draft.institution?.trim() || null,
    depreciationModel: draft.depreciationModel ?? null,
    depreciationRateBp: draft.depreciationRateBp ?? null,
    salvageValue: draft.salvageValue ?? null,
  };

  const paymentEnvelope: LedgerAccount | null = isCard
    ? {
        id: ids.paymentEnvelope,
        book: 'BUDGET',
        type: 'ENVELOPE',
        name: `Set aside for ${name}`,
        normal: 'CREDIT',
        parentId: null,
        status: 'active',
        onBudget: false,
        liquid: false,
        paymentEnvelopeId: null,
        envelopeRole: 'card_payment',
      }
    : null;

  return {
    account,
    paymentEnvelope,
    needsOpeningEntry: draft.startingBalance > 0,
    opensAsOwed: NORMAL_BY_TYPE[type] === 'CREDIT',
    // Only for things whose value can move, and only when there is a figure
    // worth recording. A mark of nothing says nothing.
    needsFirstMark: profile.revaluable && draft.startingBalance > 0,
    profile,
  };
}
