# Sovereign — feature inventory, before the redesign

Derived by reading the code at commit `a318dd7`, not from memory. Every line
here is something the app can do today. **This file is the contract for the
redesign: every line must still be true, reachable and working afterwards.**

Phase 8 walks this file line by line and marks each one pass or fail. Anything
removed, merged, hidden or deferred without being agreed first is a severity 1
finding regardless of the reason.

Counts: 17 routes · 51 sheets and overlays · 6 manual chapters with 6 working
labs · 6 chart components · 85 feature files.

---

## Routes

Every entry in `ROUTES` in `src/app/router.ts`, with the component the shell
renders for it. `AHEAD_ROUTES` (5 of them) all render `AheadView` and are
distinguished by its segmented control.

| Hash | Component | Dock tab | Notes |
| --- | --- | --- | --- |
| `#/home` | `Dashboard` | Home | Eager, in the opening bundle |
| `#/triage` | `TriageView` | Accounts | Lazy |
| `#/transactions` | `TransactionsView` | Accounts | Lazy |
| `#/budget` | `BudgetGrid` | Home | Lazy |
| `#/accounts` | `AccountsView` | Accounts | Lazy |
| `#/investments` | `InvestmentsView` | — | Lazy, quarantined chunk |
| `#/pots` | `PotsView` | Accounts | Lazy |
| `#/forecast` | `AheadView` → `ForecastView` | Ahead | Lazy |
| `#/calendar` | `AheadView` → `CalendarView` | Ahead | Lazy |
| `#/analytics` | `AheadView` → `AnalyticsView` | Ahead | Lazy within lazy |
| `#/debt` | `AheadView` → `DebtPayoffView` | Ahead | Lazy |
| `#/whatif` | `AheadView` → `WhatIfView` | Ahead | Lazy within lazy |
| `#/independence` | `IndependenceView` | Ahead | Lazy |
| `#/categories` | `CategoryManagerView` | Settings | Lazy |
| `#/settings` | `SettingsView` | Settings | Lazy |
| `#/gallery` | `Gallery` | Settings | Lazy, reached from Settings |
| `#/manual` | `ManualView` | Settings | Lazy; takes a chapter slug detail |
| `#/manual/<slug>` | `ManualView` → chapter | Settings | 6 permanent slugs |

Router behaviour that must survive:

- Hash is `#/route` or `#/route/detail`; one optional detail segment only.
- An unknown route falls back to `home` rather than erroring.
- `useRouteDetail()` is read by the view, not passed down from the shell.
- Back button steps between routes because navigation is `location.hash`.

---

## Shell — always present

- Bottom dock, 4 tabs (Home, Ahead, Accounts, Settings) plus a centre add button.
- Sliding active pill on the dock, measured from the live button, not from an index.
- `aria-current="page"` on the active tab.
- Add button opens `AddPaymentSheet` from anywhere; `aria-label="Add a payment"`.
- Dock tab ownership: Home owns `budget`; Ahead owns the 5 `AHEAD_ROUTES` plus `independence`; Accounts owns `pots`, `triage`, `transactions`; Settings owns `categories`, `manual`.
- Scrim gradient behind the dock so content fades rather than being clipped.
- `<main>` re-mounts on route change (`key={route}`), resetting scroll and view state.
- Storage warning bar at the top when storage is not durable (`role="status"`).
- `UpdateBanner` when a new service worker is waiting — "Refresh" / "Not now".
- `Toasts` — transient messages with a "Dismiss" control.
- `LockGate` wraps everything; `FirstFlightWizard` renders above the shell on a first run.
- Shell recedes and rounds (`data-receded`) while a sheet is presented.

### Startup states

- **Opening** — spinner + "Getting your money ready…" while the database opens.
- **Failed** — "Sovereign could not open your data", the error message, recovery advice, and a "Reload and try again" button.
- **View loading** — a silent height-holding placeholder while a lazy chunk arrives.
- First-flight detection requires *both* no stored completion flag and zero entries.

### Lock gate

- Privacy veil blurs the whole app on `visibilitychange` (before the app-switcher snapshot).
- Lock screen when a passcode or passkey is set; "Sovereign is locked".
- Biometric path attempted automatically when the method is biometric.
- 6-digit passcode entry, auto-submits on the sixth digit.
- Wrong passcode message; failed-biometric message offering the passcode instead.
- Re-locks after a configurable idle period on return.
- `sovereign:lock` window event locks on demand (used by Settings' "Lock now").

---

## Home (`#/home`) — `Dashboard`

- Heading "Your money".
- `SafeToSpendCard` — the anchor figure, with a `SafeToSpendSkeleton` while loading.
- Info affordance "See how this figure is worked out" → `SafeToSpendSheet`.
- Supporting figures on the card: A day, Money in, Cushion.
- "Nothing spare" state when the figure is not positive.
- `PaceCard` — spending pace, `CumulativeSpend` chart, `role="progressbar"`, "Money gone".
- `BalanceCard` — What you are worth / What you have / What you owe.
- `TriageBar` — "Anything needing you": To review count, Bills due soon.
- `GettingStarted` — "Let us get you set up", two numbered steps, "Add a bill" and "Add a payment".
- "What you have recorded" — recent entries list, each opening `PaymentDetailsSheet`.
- `AddBillSheet` reachable from the dashboard.
- Empty/first-run state instead of a negative headline when the ledger is empty (`hasActivity`).
- Error state with a "Try again" control.

### Sheets

- `SafeToSpendSheet` — the full breakdown, "In your everyday accounts and savings", links into the manual.
- `AddBillSheet` — money out or in, name, how often, next due, what it counts as.
- `PaymentDetailsSheet` — what it moved, your note, "Undo this payment", empty note state. The "what it moved" lines carry the `two-books` explanation, now with a worked example built from that entry's own two totals (4c).

---

## Ahead (`#/forecast|calendar|analytics|debt|whatif`) — `AheadView`

- Segmented control `label="What to look at"` with 5 panes: Forecast, Calendar, Where it went, Payoff, What if.
- Each pane keeps its own URL so links and the back button work per pane.
- Arriving on a non-Ahead route redirects to `forecast`.

### Forecast pane — `ForecastView`

- Heading "What is coming".
- `ForecastBand` chart — projected balance against the cushion line.
- Horizon selector, `aria-label="How far ahead to look"` — 30 / 60 / 90 days.
- "Projected balance", in-N-days figure, tightest point.
- Narrative line describing the dip and when it happens.
- "Working things out" loading state.
- "Nothing to look ahead at yet" empty state with a route to add a regular payment.
- `RunwayCard` — "How long your money would last", with category toggles.
- Amortising liabilities excluded from the projection (mortgages are not bills).

### Calendar pane — `CalendarView`

- Heading "What is due".
- Month / This week toggle (`aria-label="How much of the calendar to show"`).
- Month grid with weekday initials from the locale, today marked, dots for events.
- Previous / next month controls with aria labels.
- In/out totals for the month.
- "Scheduled payments" list.
- `DayDetailSheet` on tapping a day — the day's events as rows, and "That day, in less out" where there is more than one.
- `AddBillSheet` reachable from the calendar.
- `SubscriptionAudit` — "Worth a look": a rise, a category gone quiet, a charge that is not in the bills. Mounted inside `CalendarView`, under the grid (4b; it used to sit in `AheadView` above the calendar's own heading).

### Where it went pane — `AnalyticsView`

- Heading "Where it went".
- Period selector: This month / Last month / Last 90 days / This year.
- `SankeyFlow` chart — where money went, income → categories.
- `CategoryBars` — spending by group and category.
- "How this compares to your normal" — trailing-median baselines.
- "Still learning your rhythm" state with weeks-of-records so far.
- Empty states: "Nothing to look at yet", "Nothing was recorded in this period. Try a wider window above.", "No spending recorded in this period."
- A detail sheet for drilling into a category.

### Payoff pane — `DebtPayoffView`

- Heading "Paying it off".
- "What you put towards it each month" — editable monthly figure, tap to change.
- Minimum-payment floor stated.
- "Two ways of going about it" — avalanche and snowball, months and interest for each, which costs least / which clears one soonest.
- "The order things disappear" — the payoff sequence.
- A sheet for editing the monthly amount.

### What if pane — `WhatIfView`

- Heading "What if".
- Branch list; "No what-ifs yet" empty state with "Start one".
- `NameSheet` — "What are you wondering about?", starting from.
- `ChangeSheet` — what is it, how much, what kind of spending, starting when.
- "Where the ninety days end" — as things are vs with this what-if.
- "What changes in this one" list; "Nothing yet. Add a change and both lines will move apart."
- Nothing here is written to the ledger.

---

## Accounts (`#/accounts`) — `AccountsView`

- `DeferredTaxCard` — tax waiting inside this / what holding this costs a year, what that leaves, what was counted and excluded. Only shown when a tax regime is set. **Moved here from Investments in 4b**: a deemed-return charge falls on the whole estate, so a figure worked out from the brokerage alone told a household with money in the bank that it owed nothing. Investments links to it.

- Heading "Accounts".
- "What you are worth" summary.
- Accounts grouped by type, each row opening `AccountDetailSheet`.
- `NetWorthHistoryCard` — "How this has moved", `NetWorthTimeline` chart.
- "What each payment does" explanation affordance.
- "Pay this bill" action on card accounts.

### Sheets reachable from Accounts

- `CreateAccountSheet` — name, currency, who holds it.
- `AccountDetailSheet` — rename ("What to call it"), "Checked against your bank", "The terms", "What it has been worth" history, "Update value", "Check against a statement", how this account is treated (with the `safe-to-spend` explanation beside it), archive (must be empty first), reopen a locked check.
- `ConvertCurrencySheet` — From / Into.
- `ReconcileAccountSheet` — statement ending date, closing balance, tick off entries, Locked / Ticked off / Not ticked off states.
- `RecordValuationSheet` — new estimated value, as-at date, why.
- `PayCardSheet` — how much are you paying, on your card, already set aside.
- `PaybackSheet` — how much came back, you fronted, already paid back, still owed after this.
- `WriteOffSheet` — write off money owed to you, with a category, "Keep waiting".
- `LoanScheduleSheet` — amortisation schedule; builds your equity / interest / tax and insurance.
- `LoanTermsSheet` — rate, fixed or not, monthly payment, escrow, original principal, term, next due.
- `DebtTermsSheet` — interest rate, minimum payment, credit limit, due day.
- `RecordLoanPaymentSheet` — off what you owe, interest, paid from, out of which pot, when, anything extra.

---

## Transactions (`#/transactions`) — `TransactionsView`

- Heading "Everything you have recorded".
- Search field, `aria-label="Search everything you have recorded"`, debounced.
- Filter chips: Locked, Has not gone through yet, Gone through, Has a note, Split across categories.
- `FilterSheet` — From / To dates, At least / At most amounts, "Show these".
- Active-filter description line and "Clear the filters".
- Month group headers.
- Selection mode: multi-select rows, `SelectionBar` ("What to do with what you have chosen") for bulk triage and tagging.
- `TagSheet` — add and remove tags on the selection.
- `PaymentDetailsSheet` on a row.
- Pagination / incremental loading.
- Empty states: "Nothing matches that", "Nothing recorded yet".

---

## Triage (`#/triage`) — `TriageView`

- Heading "To review".
- Staged (imported, unreviewed) rows.
- `SwipeRow` gestures: swipe to confirm, swipe to defer/recategorise — both also available as real focusable buttons for keyboard and switch control.
- `CategoryPicker` — "Which category was it?", with an "always file to this" toggle.
- `SplitEditor` — split one payment across several categories.
- Bulk filing — "Where do they all belong?".
- `ImportSheet` — which account, what Sovereign will bring in, "Are these the right way round?" sign detection, CSV column mapping.

---

## Budget (`#/budget`) — `BudgetGrid`

- Heading "Envelopes".
- Period navigation: "The period before" / "The period after", with aria labels.
- "Assigned this period" total.
- Envelope tiles grouped, each in its category's family colour, with a pacing ring: the arc is what has gone, the tick is where the period is. One hot mark names the worst overspend and counts the rest.
- `QuickAssignSheet` — assign to one envelope.
- `AssignSheet` — the fuller assign flow.
- `QuickCoverSheet` — cover an overspent envelope from another.
- `BudgetSettingsCard` — how the budget is divided up, periods run (monthly/fortnightly/weekly), a day you were paid, what happens when a pot goes over.
- "No pots to fill yet" empty state.
- Multi-month planning via the cadence engine.

---

## Pots (`#/pots`) — `PotsView`

- Heading "Your pots".
- Pot rows with progress towards target and what is needed this period.
- `PotSheet` — amount you need, what is it for, how does this one work (three pot kinds), does it come round again, "No rush. I put in what I can".
- `TopUpSheet` — amount to set aside.
- "Change it" action.
- "Nothing set up yet" empty state.

---

## Recording, and what each entry does to the figures

Five explanations added in 4c, each replacing an inline paragraph that said the
same thing beside one control on one screen:

| Topic | Answers | Reached from |
| --- | --- | --- |
| `fronted` | Money you paid on somebody else's behalf, and why it is never your spending | `AddPaymentSheet`, `PaybackSheet`, `WriteOffSheet` |
| `transfers` | Why moving money between your own accounts is neither earning nor spending | `AddPaymentSheet`, `ConvertCurrencySheet` |
| `valuations` | Why a house going up is not income and a car going down is not spending | `RecordValuationSheet` |
| `corrections` | That nothing is deleted — an undo is a second entry that cancels the first | `PaymentDetailsSheet` |
| `rules` | What "always file this shop here" does, and that it never touches the past | `CategoryPicker`'s always-file toggle |

---

## Investments (`#/investments`) — `InvestmentsView`

- Heading "Invested".
- "What it is all worth" — the screen's one field, in the transport family, with what went in, the growth and the fund fee in the strip.
- Drift tile — the class furthest **behind** its target, with a pacing ring and the deposit that would close it. Opens `RebalanceModal`. Present only when targets are set and the mix is off; the header's "Targets" button takes its place when it is absent.
- `AssetAllocationBar` — "How it is spread". One 44px stacked bar in the category families, then every slice named with its value and share.
- `HoldingsList` — per-holding rows, each with the security's family square and a sparkline of its recent prices.
- `FeeDragCard` — "What the funds charge". Three horizons on a shared scale; says "more" or "less than a cheap tracker takes" according to which way the comparison runs.
- Link through to the deferred-tax figure on Net worth. **The card itself moved to `AccountsView` in 4b** — see below.
- Empty states: "No investment accounts yet", "Nothing recorded yet".

### Sheets

- `AddHoldingSheet` — account, symbol, full name, kind, shares, price, total cost, yearly fee.
- `HoldingDetailSheet` — "What it has been priced at", "Where the return came from", the holding, price per share, yearly fee, "Sell shares", "Record a payout".
- `SellHoldingSheet` — how many shares, price sold at, dealing fee, where the money goes.
- `RecordDividendSheet` — into my bank or bought more shares, how much, tax taken off, shares it bought, which account.
- `InvestSheet` — how much, from, into.
- `UpdatePricesSheet` — paste prices in bulk (`parsePastedPrices`).
- `RebalanceModal` — "How each part stands", what you want, what to do, new money to invest, where to put it.

---

## Categories (`#/categories`) — `CategoryManagerView`

- Heading "Categories, rules and tags".
- Tabs: Categories / rules / tags.
- Group and category tree with archive state ("No longer used").
- `AddGroupSheet`, `CategorySheet` — what is it called, which group.
- `ArchiveSheet` — "Nothing is deleted, and you can put it back at any time.", "Keep using it".
- "Edit" and "Archive" actions.
- Rules list with "Edit rule"; "No rules yet".
- Tags list; "No tags yet".
- Empty states: "Nothing set up yet", "Nothing in this group yet."

---

## Independence (`#/independence`) — `IndependenceView`

- Headings "When you could stop", "The landmarks".
- "What you are working with" — invested today, going in each month, a year costs you, how much you draw each year.
- `GrowthBand` chart — "How it might grow".
- Milestone list (landmarks), only ones actually reached are marked.
- `EditSheet` for each assumption, with "Use this".
- Assumptions persist in `useIndependenceAssumptions`.

---

## Settings (`#/settings`) — `SettingsView`

- Heading "Settings".
- **Currency** — select from `COMMON_CURRENCIES`, with a toast confirming the change.
- **Appearance** — System / Light / Dark, with a line saying what is currently in force.
- **Keeping your records** (`ProtectStorage`) — explanation, "Protect storage", persistence outcome toast.
- **Your data** (`DataAndSecurity`) — export everything (plain or encrypted with a passphrase or a recovery phrase), restore from a file, and the restore confirmation step.
- **Locking Sovereign** — set a 6-digit passcode with confirmation, enable biometrics, "Lock now", turn the lock off.
- **Recovery phrase** (`RecoveryPhrase`) — generate a BIP-39 phrase, reveal it, confirm it is written down.
- **Exchange rates and currencies** — explanation, `FxRatesSheet` (rates as at a date, paste rates in bulk).
- **Where your data lives** — storage explanation and whether the browser has agreed to keep it.
- **Categories and rules** — routes to `#/categories`.
- **Tax** — regime (none / Dutch Box 3 / flat gains), CGT rate, CGT exemption.
- **The field manual** — routes to `#/manual`.
- **Setting up** — re-run the First Flight walkthrough.
- **Design system** — routes to `#/gallery`.
- **Start again** — reset the database, with a confirmation step, then re-seed the starter chart.

---

## The field manual (`#/manual`)

Contents page: heading "The field manual", an explanation of the two tiers, and
six chapter entries with title and standfirst. Chapter pages have a back link,
a "Chapter N · engine" line, the title, the body, and previous/next navigation.

The six slugs are permanent URLs and must not change.

| Slug | Title | Engine | Lab controls |
| --- | --- | --- | --- |
| `safe-to-spend` | The one number | Safe to Spend | Cash you can reach today · Bills due in the next month · Owed on cards · Your cushion · Put by in pots · Days left in the period · Days until you are paid |
| `two-books` | Two sets of books | The ledger | "What happened" switch over entry kinds; both books shown with their own totals |
| `pots` | Putting money by | Sinking funds | What kind of pot · What was in it when the month began · Put in so far this month · Months until you need it |
| `cards` | Cards and mortgages | Card reserves | What you owe it on · Balance on the card · This month's mortgage payment |
| `selling` | What a sale actually costs | Tax lots | Shares to sell · Price you are selling at · Fees |
| `checking` | Checking against the bank | Reconciliation | What the bank says the closing balance was |

Manual building blocks in `parts.tsx` that must survive: `Passage`, `Heading`,
`Aside`, `Formula`, `Points`, `Lab`, `Controls`, `Dial`, `Switch`, `Readout`,
`Ledger`, `EngineSays`.

Every lab runs the real engine on invented figures and says so on its face, in
every chapter, where it cannot be scrolled past.

`ManualLink` deep-links into a chapter from the screen that needs it, and
imports only the router and `slugs.ts` — never `./chapters`.

---

## Onboarding — `FirstFlightWizard`

Six steps, a progress bar (`role="progressbar"`), and a "Not now" escape on every step.

1. **StepPromise** — what the app is, that nothing leaves the device, and "What do you count in?" (currency).
2. **StepWhereItIs** — accounts and balances.
3. **StepWhatYouOwe** — cards and loans.
4. **StepRegulars** — bills and pay: what is it called, how much, how often, next one due.
5. **StepSaving** — pots: what is it for, target.
6. **StepTheNumber** — the payoff: what you have, already promised, your cushion, put by in pots, safe to spend.

Building blocks in `onboarding/parts.tsx`: `StepFrame`, `Field`, `TextBox`,
`MoneyBox`, `readAmount`, `Choice`, `AddedList`, `Aside`, `Term`.

Re-runnable from Settings → Setting up.

---

## Design system gallery (`#/gallery`)

Every primitive in the states it is used in: Money at anchor / figure / lead /
body / caption sizes, adaptive decimals, StatPills, SwipeRow, Chips, Buttons in
four variants and three sizes plus disabled, BottomSheet, Tabs, Input, Select,
Numpad. Reached from Settings.

---

## Charts

| Component | Used by | Mechanic today |
| --- | --- | --- |
| `CumulativeSpend` | `PaceCard` | Cumulative spend against an even-spread line, scrubber, `WIDTH = 320` |
| `ForecastBand` | `ForecastView` | Projected balance with a cushion line, scrubber, `WIDTH = 320` |
| `GrowthBand` | `IndependenceView` | Growth projection band, `WIDTH = 320` |
| `NetWorthTimeline` | `NetWorthHistoryCard` | Actual net worth only — **never projected forward** — with milestones, `WIDTH = 320` |
| `SankeyFlow` | `AnalyticsView` | Income → categories flow ribbons |
| `CategoryBars` | `AnalyticsView` | Ranked category bars |

None of them sets `vector-effect`, so strokes render heavier than designed on
anything wider than 320pt.

---

## Calculations surfaced to the user

| Calculation | Where it is shown | Engine |
| --- | --- | --- |
| Safe to spend | Home anchor, onboarding step 6, manual ch.1 | `core/liquidity/safeToSpend` |
| Daily allowance, over the pace horizon | Home, SafeToSpendSheet | `core/liquidity/pacing` |
| Spending pace vs even spread | `PaceCard` | `core/liquidity/pacing` |
| Cushion / buffer | Home, Settings, onboarding | `app/config` + liquidity |
| Cycle and cadence (monthly / fortnightly / weekly) | Home, Budget | `core/liquidity/period` |
| Net worth, and change since last month | Home, Accounts | `core/ledger/balances` |
| Net worth history | `NetWorthHistoryCard` | `core/analytics/netWorthHistory` |
| Milestones reached | Independence, net worth | `core/analytics/milestones` |
| Envelope pacing and cover | Budget, pots | `core/budget/envelopePacing` |
| Multi-month budget plan | Budget grid | `core/budget/multiMonth` |
| Sinking-fund requirement per period | Pots, manual ch.3 | `core/goals/sinkingFund` |
| 90-day balance projection | Forecast | `core/forecast/projection` |
| Runway, with category toggles | `RunwayCard` | `core/forecast/runway` |
| What-if projection against the base | What if | `core/ledger/branching` |
| Debt payoff: avalanche and snowball | Payoff | `core/simulate/debt` |
| Amortisation schedule | Loan schedule sheet | `core/debt/amortization` |
| FIRE / independence projection | Independence | `core/simulate/fire` |
| Category distribution | Where it went | `core/analytics/categoryDistribution` |
| Money flow (Sankey) | Where it went | `core/analytics/sankeyFlow` |
| Trailing median baselines | Where it went | `core/analytics/trailingMedian` |
| Subscription surveillance | Calendar | `core/recurring/surveillance` |
| Recurrence occurrences | Calendar, forecast | `core/recurring/occurrences` |
| Asset allocation | Investments | `core/investments/assetAllocation` |
| Fee drag | `FeeDragCard` | `core/investments/feeDrag` |
| Rebalance instructions | `RebalanceModal` | `core/investments/rebalance` |
| FIFO disposal and realised gain | Sell sheet, manual ch.5 | `core/investments/disposals` |
| Deferred tax (Box 3 and flat gains) | `DeferredTaxCard` | `core/tax/deferred` |
| Reconciliation difference | Reconcile sheet, manual ch.6 | `core/reconciliation` |
| Card reserve against safe-to-spend | Home, manual ch.4 | `core/liquidity` |
| Cross-currency conversion and FX return | Convert sheet, accounts | `core/money/fx`, `fxReturns` |
| Payee normalisation and merchant memory | Entry, triage | `core/taxonomy` |
| Keypad arithmetic (+ − × ÷ =) | Numpad | `core/money/expression`, `keypad` |

---

## Cross-cutting behaviours that must survive

- **Currency abstraction.** No component may hardcode a currency symbol; every
  amount goes through `<Money>` / `useMoney`. Enforced by `format.test.ts`.
- **Ledger invariants I1–I10** checked on every write.
- **Two books** (FINANCIAL and BUDGET), each balancing independently.
- **Live queries** invalidate from a table-name bus; no manual refetching.
- **Projections are derived on the fly, never stored.**
- **Net worth is never projected forward.**
- **Amortising liabilities are excluded** from the forecast and from the Box 3 estate.
- **Layering**: `core` ← `data` ← `app` ← `design` ← `features`, enforced by eslint.
- **Chunk quarantine**: analytics, investments, accounts, budget, manual and the
  gallery each stay out of the opening bundle.
- **`slugs.ts` barrel-leak avoidance.**
- **Viewport lock** (`inset: 0`, never `vh`/`dvh` for layout).
- **Unprefixed `backdrop-filter`** — the minifier collapses a hand-written pair.
- **Touch sanitation**: no callout, no tap highlight, selection opt-in only.
- **`prefers-reduced-motion`** disables transitions and animations globally.
- **Focus-visible rings** on every interactive element.
- **`role="progressbar"`** on pacing bars and the onboarding progress.
- **16px minimum font-size** on inputs, so iOS does not zoom on focus.
- **Accessible swipe actions**: every swipe has an equivalent focusable button.
- **Focus trap and restore** in every bottom sheet.
- **PWA**: service worker precache, update banner, OPFS + SQLite worker,
  `crossOriginIsolated` via COOP/COEP.
