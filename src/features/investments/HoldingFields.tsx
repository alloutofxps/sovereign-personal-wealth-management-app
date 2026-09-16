/* ===========================================================================
 * A HOLDING'S SEVEN INPUTS, DEFINED ONCE
 * ---------------------------------------------------------------------------
 * Symbol, name, kind, shares, price, cost and fee. Two screens ask for them —
 * `AddHoldingSheet` for one more holding in an account that already has some,
 * and `PortfolioSetupSheet` for the first several — and for a while they each
 * had their own copy.
 *
 * That is M5's shape and the third time this project has been bitten by one
 * thing stated in two places: the field rule against the motion section, the
 * hot accent budget against the describe/name rule, and this. Each time both
 * copies were correct when written, nothing compared them, and the one that
 * drifted was not the one anybody was reading.
 *
 * Nothing here is clever. The point is that there is one of it — one set of
 * placeholders, one set of hints, one lenient parse, one definition of what
 * makes a row complete. A screen that wants to collect a holding renders
 * `HoldingFields` and reads `readHoldingDraft`, and cannot disagree with the
 * other screen about what a holding is.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DRAFT IS STRINGS
 *
 * Because somebody typing "1." or "0.0" is mid-keystroke, not wrong. The
 * draft holds exactly what was typed; `readHoldingDraft` parses leniently for
 * a preview and reports whether the row is complete. Nothing throws at
 * somebody while they are still typing, and the strict parse happens once, on
 * save, in the repository.
 * ======================================================================== */

import { basisPoints, minor, type BasisPoints, type Minor } from '@/core/money';
import {
  ASSET_CLASS_MEANINGS,
  ASSET_CLASS_NAMES,
  HOLDABLE_ASSET_CLASSES,
  marketValue,
  parseQuantity,
  type AssetClass,
} from '@/core/investments';
import { Input, Select } from '@/design/ui';

/** What was typed, before any of it is believed. */
export interface HoldingDraft {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  shares: string;
  price: string;
  cost: string;
  fee: string;
}

export const EMPTY_HOLDING_DRAFT: HoldingDraft = {
  symbol: '',
  name: '',
  assetClass: 'equity',
  shares: '',
  price: '',
  cost: '',
  fee: '',
};

/** Shares as an exact integer at 1e8, or zero while it is unreadable. */
function readQuantity(text: string): number {
  try {
    return parseQuantity(text);
  } catch {
    return 0;
  }
}

/**
 * Minor units from a typed decimal, or zero while it is unreadable.
 *
 * This is `AddHoldingSheet`'s parse rather than the looser one the set-up
 * screen had. It refuses more than two decimal places outright instead of
 * rounding them away, which is the stricter and the better of the two — and
 * the two differing at all is the drift this module exists to end. Where the
 * copies disagreed, the careful one won.
 */
function readAmount(text: string): number {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

/** A percentage to basis points: `0.22` becomes 22. Same strictness. */
function readPercent(text: string): number {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0;
  return Math.round(Number(cleaned) * 100);
}

export interface ReadHolding {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity1e8: number;
  priceMinor: Minor;
  costBasis: Minor;
  expenseRatioBp: BasisPoints;
  /** What the position is worth at the price given. */
  value: Minor;
  /** Enough has been typed to record it. */
  ready: boolean;
}

/**
 * The one reading of a draft.
 *
 * `ready` is the single definition of a complete row, which is the thing two
 * screens most needed to agree on — one of them used to accept a holding with
 * no price and show it as worth nothing.
 */
export function readHoldingDraft(draft: HoldingDraft): ReadHolding {
  const quantity1e8 = readQuantity(draft.shares);
  const priceMinor = minor(readAmount(draft.price));
  const symbol = draft.symbol.trim().toUpperCase();
  const name = draft.name.trim();

  return {
    symbol,
    name,
    assetClass: draft.assetClass,
    quantity1e8,
    priceMinor,
    costBasis: minor(readAmount(draft.cost)),
    expenseRatioBp: basisPoints(readPercent(draft.fee)),
    value: quantity1e8 > 0 && priceMinor > 0 ? marketValue(priceMinor, quantity1e8) : minor(0),
    ready: symbol !== '' && name !== '' && quantity1e8 > 0 && priceMinor > 0,
  };
}

export function HoldingFields({
  value,
  onChange,
  /** Set when the account quotes in a currency that is not the household's. */
  priceCurrency,
}: {
  value: HoldingDraft;
  onChange: (next: HoldingDraft) => void;
  priceCurrency?: string;
}) {
  const set = <K extends keyof HoldingDraft>(key: K, next: HoldingDraft[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      <div className="grid grid-cols-[7rem_1fr] gap-3">
        <Input
          label="Symbol"
          value={value.symbol}
          onChange={(e) => set('symbol', e.target.value.toUpperCase())}
          placeholder="VWCE"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Input
          label="Full name"
          value={value.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Vanguard FTSE All-World"
        />
      </div>

      <Select
        label="What kind of thing is it"
        value={value.assetClass}
        onChange={(e) => set('assetClass', e.target.value as AssetClass)}
        options={HOLDABLE_ASSET_CLASSES.map((cls) => ({
          value: cls,
          label: ASSET_CLASS_NAMES[cls],
        }))}
        hint={ASSET_CLASS_MEANINGS[value.assetClass]}
      />

      <Input
        label="How many shares"
        value={value.shares}
        onChange={(e) => set('shares', e.target.value)}
        placeholder="15.5"
        inputMode="decimal"
        hint="Fractions are fine, up to eight decimal places."
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Price per share"
          value={value.price}
          onChange={(e) => set('price', e.target.value)}
          placeholder="118.50"
          inputMode="decimal"
          {...(priceCurrency ? { hint: `In ${priceCurrency}, as your statement quotes it.` } : {})}
        />
        <Input
          label="What it all cost"
          value={value.cost}
          onChange={(e) => set('cost', e.target.value)}
          placeholder="5500.00"
          inputMode="decimal"
          hint="The whole position, not per share."
        />
      </div>

      <Input
        label="Yearly fee"
        value={value.fee}
        onChange={(e) => set('fee', e.target.value)}
        placeholder="0.22"
        inputMode="decimal"
        hint="The fund's ongoing charge, as a percentage. Leave it blank if you do not know."
      />
    </>
  );
}
