# SoftGlaze — UI Design System

**The SoftGlaze Stock Manager UI** is a warm-orange, **light-first** admin design on
SoftGlaze's own palette. Every value below is copied from the live source — treat these
files as the source of truth and this document as their written index:

- `apps/web/src/index.css` — `@theme` tokens, light/dark CSS variables, component classes
- `apps/web/index.html` — Google Fonts (Nunito + JetBrains Mono)
- `apps/web/src/components/ui.tsx` — shared React primitives
- `apps/web/src/components/Layout.tsx` — sidebar, page shell, footer

> **This file is the source of truth for the UI.** Where any older doc mentions a
> different design or fonts, this document wins. See **History** at the bottom.

---

## 1. Design language & principles

- **Light-first.** Default theme is **light**; dark is a fully
  supported option (`[data-theme="dark"]`). Both must be flawless — never ship a
  screen that only looks right in one theme.
- **Warm-orange primary.** The accent is **`#ff9f43`**
  (same hue in both themes). It is the single "primary action" colour.
- **Green = money.** `--money` / `--success` (green) is reserved for **money-critical
  confirmations and positive figures** (Complete Sale, Receive Payment, "Paid",
  positive deltas). Orange is the everyday primary; green means "this touches cash".
  Never use green as a generic accent, and never use orange for a money-confirm button.
- **Minimal radius, compact density.** Cards 10px, buttons/inputs 8px, pills 7px,
  small chips/deltas 6px. Row-dense tables, 14px base font, tight but breathable
  padding. Soft, low, floaty shadows — not heavy drop shadows.
- **Never hardcode colours — always tokens.** Use the semantic Tailwind utilities
  (`bg-surface`, `text-ink`, `border-edge`, `text-accent`, …) or `var(--…)`. A raw
  hex in a component is a bug: it breaks theming. The only place hex lives is
  `index.css`.

---

## 2. Typography

Loaded once in `apps/web/index.html`:

```html
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />
```

| Role | Family | Token / class | Notes |
|---|---|---|---|
| Display / headings | **Nunito** | `--font-display`, class `.display`, `h1–h3` | weight 700, `letter-spacing: -0.01em` |
| Body / UI | **Nunito** | `--font-body` (`font-body`) | base **14px**, line-height 1.5 |
| Prices / amounts | **Nunito, tabular** | class **`.money`** | `font-variant-numeric: tabular-nums`, weight 600 — renders **₨** cleanly and aligns money in columns |
| Codes / SKUs / IDs | **JetBrains Mono** | `--font-mono` (`font-mono`) / class **`.mono`** | invoice numbers, SKUs, phone, ledger IDs; tabular, `-0.02em` tracking |

Rule of thumb: **`.money` for currency figures, `.mono` for identifiers.** Prices are
*not* set in the mono face — Nunito tabular figures were chosen so the ₨ glyph and the
digits read together as one clean number.

---

## 3. Colour system

All colours are CSS variables defined in `index.css` under `:root, [data-theme="light"]`
and `[data-theme="dark"]`, then exposed to Tailwind through the `@theme inline` block as
`--color-*`. **Use the utility, not the hex.**

### Core tokens — hex values (copied from `index.css`)

| Semantic role | CSS var | Tailwind utility | **Light** | **Dark** |
|---|---|---|---|---|
| App background | `--bg` | `bg-app` | `#fafbfe` | `#0f1118` |
| Surface (cards) | `--surface-solid` | `bg-surface` | `#ffffff` | `#191c26` |
| Surface-2 (headers/hover/panels) | `--surface-2` | `bg-surface-2` | `#f8f9fa` | `#20242f` |
| Surface-3 | `--surface-3` | `bg-surface-3` | `#f2f4f7` | `#282d3a` |
| Border (hairline) | `--border` | `border-edge` | `#eaedf2` | `#272c39` |
| Border strong (inputs) | `--border-strong` | `border-edge-strong` | `#e2e6ec` | `#343a4a` |
| Text / ink | `--text` | `text-ink` | `#212b36` | `#eceef4` |
| Text muted | `--text-muted` | `text-muted` | `#5b6670` | `#9aa3b6` |
| Text faint | `--text-faint` | `text-faint` | `#98a2b3` | `#6a7488` |
| **Accent (primary)** | `--accent` | `text-accent` / `bg-accent` | `#ff9f43` | `#ff9f43` |
| Accent hover | `--accent-hover` | `bg-accent-hover` | `#ff851a` | `#ffb268` |
| Accent-2 (light tint) | `--accent-2` | `accent-2` | `#ffb570` | `#ffb570` |
| Accent ink (text on accent) | `--accent-ink` | `text-accent-ink` | `#ffffff` | `#1a1000` |
| Accent soft (tint bg) | `--accent-soft` | `var(--accent-soft)` | `#fff6ee` | `accent @16%` |
| **Money / success (green)** | `--money` / `--success` | `text-money` / `text-success` | `#55ce63` | `#34d399` |
| Danger | `--danger` | `text-danger` | `#f62d51` | `#f87171` |
| Warn | `--warn` | `text-warn` | `#ffbc34` | `#fbbf24` |
| Info | `--info` | `text-info` | `#009efb` | `#60a5fa` |
| Navy (secondary) | `--navy` | `text-navy` | `#092c4c` | `#93b4d6` |
| Purple | `--purple` | `text-purple` | `#7367f0` | `#a78bfa` |

### Extended accents (available as utilities, use sparingly)

`--teal` (`#0e9384` / `#2dd4bf`), `--cyan` (`#06aed4` / `#22d3ee`),
`--pink` (`#dd2590` / `#f472b6`), `--indigo` (`#3538cd` / `#818cf8`),
`--orange` (`#e04f16` / `#fb923c`), `--emerald` (`#55ce63` / `#34d399`).
Use these for chart series / FormSection icon accents, not for buttons.

### Shadows & ring (tokens)

`--shadow-card` (resting card), `--shadow-md` (modals/toasts/hover),
`--shadow-lg` (large dialogs), `--shadow-color` (orange-tinted glow under
primary buttons/tiles), `--ring` (focus ring, accent @26% light / @40% dark).

### The money rule (repeat)

> **Orange (`--accent`) = primary action. Green (`--money`/`--success`) =
> money-critical confirm + positive figures + "Paid".** `--danger` = destructive /
> unpaid / overdue. Keep this discipline so a glance at any screen lands the eye on
> the money.

---

## 4. Radii, density & shadows

| Element | Radius |
|---|---|
| `.card`, modal shell, brand mark | **10px** |
| `.btn`, `.input`, `.panel`, `FormSection` | **8px** |
| `.pill` (status pill) | **7px** |
| `.delta`, small icon badges (`rounded-md`) | **6px** |

- Base font 14px / line-height 1.5; headings weight 700, `-0.01em` tracking.
- Tables are dense: `~8–10px` cell padding, hairline `border-edge` row dividers,
  `hover:bg-surface-2/50` row hover.
- Content max width `1600px`, page padding `p-4` (mobile) → `lg:p-7`.
- Reduced-motion: all transitions/animations are disabled under
  `prefers-reduced-motion: reduce`.

---

## 5. Component library (CSS classes in `index.css`)

| Class | Use it for… |
|---|---|
| `.card` | The default surface — white/`surface-solid`, 1px `edge`, 10px, `shadow-card`. Wraps tables, modals, panels. Auto `overflow-x: auto` when it directly contains a `<table>`. |
| `.card-hover` | Add to a card that should lift on hover (`translateY(-2px)` + `shadow-md`). Use on clickable KPI tiles / nav cards. |
| `.panel` | A quieter inset block — `surface-2` bg, 8px. Sub-sections inside a card. |
| `.btn` | Base button (inline-flex, gap 8px, weight 600, 8px radius, `9px 16px`). Always pair with a variant. Focus-visible shows the accent ring. |
| `.btn-primary` | **The primary CTA** — orange `accent` bg, `accent-ink` text, orange glow. One per view (Save, Create). |
| `.btn-secondary` | Neutral action — surface bg, `edge-strong` border; hovers to accent border/text + `accent-soft`. Cancel, Close, View, secondary toolbar actions. |
| `.btn-ghost` | Transparent icon/utility button (`text-muted`, hover `surface-2`). Pagination arrows, close ✕, toolbar icons. |
| `.btn-danger` | Destructive confirm — `danger` bg. Delete, Confirm return, Cancel document. |
| `.btn-money` | **Money-critical confirm only** — green `money` bg + green glow. Complete Sale, Receive Payment. Never use for ordinary saves. |
| `.input` (also `select.input`, `textarea.input`) | All form fields — full width, 8px, `edge-strong` border; focus = accent border + 4px ring. In dark it sits on `surface-2`. |
| `.label` | Field label above an input (12.5px, weight 600, `muted`, 6px gap). |
| `.money` | Any currency figure — Nunito tabular, weight 600. Right-align in tables. |
| `.mono` | SKUs, invoice/doc numbers, phone, IDs — JetBrains Mono, tabular. |
| `.chip` | Tiny uppercase label (11px, weight 700, `faint`) — section eyebrows / meta tags. |
| `.pill` | Status pill (7px) for Recent Sales / transaction rows. |
| `.delta` + `.delta-up` / `.delta-down` | % -change badge — green up / red down, tinted background. KPI trend indicators. |
| `.tile-grad` | Solid-accent icon tile (orange bg, white glyph, orange glow) — brand mark, empty-state icon, avatar squares. |
| `.glass` | Translucent + blurred surface — the sidebar and sticky bars. |
| `.gradient-text` | Accent-coloured text emphasis (currently a flat `--accent`). |
| `.divide-hair` | Adds `border-edge` hairlines between stacked children. |

Table headers styled via `.card table thead th` are 11px, weight 700, UPPERCASE,
`faint` — the shaded-header pattern (see §8) sets `bg-surface-2` on the header row.

---

## 6. Shared React components (`apps/web/src/components/ui.tsx`)

Import these instead of re-implementing. They already carry the tokens.

| Component | Purpose / API |
|---|---|
| **`PageHeader`** | Top of every page. Props `title`, `sub?`, `actions?`. Renders a **breadcrumb** (`🏠 Dashboard › Title`), a 22px extrabold `.display` heading, optional sub-line, and a right-aligned actions slot (e.g. a "New …" button). |
| **`FormSection`** | Titled card section for **all add/edit forms**. Props `title`, `icon`, `color?` (default `var(--accent)`), `children`. Header is `bg-surface-2` with a colour-tinted icon badge; body is padded. Stack several per form (e.g. Details = accent, Items = info, Charges & payment = success). |
| **`Modal`** | Dialog. Props `open`, `onClose`, `title`, `children`, `wide?`. Esc + backdrop close; blurred `black/55` scrim; `card` shell (`max-w-md`, or `max-w-2xl` when `wide`); sticky header with title + ghost ✕; scrollable body. |
| **`ConfirmDialog`** | Built on `Modal` for **every destructive action**. Props `open`, `title`, `message`, `confirmLabel="Delete"`, `busy?`, `onConfirm`, `onClose`. Cancel = `btn-secondary`, confirm = `btn-danger`. Name the item in `message` and `confirmLabel`. |
| **`Badge`** | Small status pill, `tone`: `success` \| `warn` \| `danger` \| `muted` (tinted bg + border). Use for row status (Completed / Return / Paid / Unpaid). |
| **`SearchBox`** | Search input with leading magnifier icon. Props `value`, `onChange`, `placeholder?`. Top-left of every list. |
| **`EmptyState`** | Designed empty state. Props `title`, `hint?`, `action?`. `tile-grad` package icon, centred; put a "create" button in `action`. Show it whenever a list is empty (differentiate "no data yet" vs "no match"). |
| **`TableSkeleton`** | Loading placeholder. Props `rows=6`, `cols=5`; animated `bg-surface-2` pulse bars. Render while `isLoading`. |
| **`Pagination`** | List pager. Props `page`, `pages`, `onPage`, and optional `total` + `perPage`. Hidden when `pages <= 1`. When `total`+`perPage` are given it shows **"Showing X–Y of N"** on the left; ghost prev/next + "Page X of Y" on the right. |
| **`useClientPagination<T>(rows, perPage=12)`** | **Client-side pagination for full-list endpoints** (those that return every row). Returns `{ page, pages, setPage, pageRows, total, perPage }`; auto-clamps `page` when the list shrinks (e.g. after filtering). Feed its return values straight into `<Pagination/>`. |
| **`ToastProvider` / `useToast`** | App-wide toasts. `toast(message, tone?)` with tone `success` (default, green) \| `error` (red); auto-dismiss after 4s; top-right, `card` styled. **Every successful save fires a toast carrying the document number**, e.g. `` toast(`Purchase ${d.purchase.invoiceNo} saved`) ``. |

---

## 7. Layout & navigation (`Layout.tsx`)

- **Collapsible, grouped sidebar** (`w-64`, `.glass`, `border-r`):
  - **Dashboard** is a standalone top link (no group header).
  - Then collapsible sections: **Sell · Inventory · People · Money · Insights ·
    Admin**, each a chevron-toggled group. The section that contains the current
    route auto-opens; the active section header turns `text-accent`.
  - Active standalone link = solid accent fill + white text + orange glow.
    Active sub-item = `text-accent` + `accent-soft` bg with a filled dot marker.
  - Items are **role-filtered** (`roles` array hides links the user can't use —
    the **server still enforces** RBAC; the client only hides UI).
  - Sidebar footer: user account button (initials `tile-grad` avatar) +
    `NotificationBell` + `ThemeToggle` + Logout.
  - **Brand mark**: shop logo if uploaded, else an `Anvil` glyph on a `tile-grad` tile.
- **Mobile**: sidebar becomes a fixed slide-in drawer behind a scrim; a `.glass`
  top bar provides the hamburger, brand, and bell.
- **Page shell**: content is centred at `max-w-[1600px]`, padded `p-4`/`lg:p-7`,
  followed by a **footer** (`© <year> <ShopName>. All rights reserved.` ·
  "SoftGlaze Stock Manager").
- A global **Calculator** widget is mounted app-wide (also usable inside POS).
- First run: a SUPER_ADMIN whose `onboarding_done` ≠ `1` is redirected to
  `/onboarding` to pick a Business Type.

---

## 8. Standard page patterns

Grounded in `pages/Sales.tsx` and `pages/Purchases.tsx` — copy these shapes.

### Every list page
1. `PageHeader` (with a `sub` that surfaces the key total, e.g. total sales / total
   due, and an `actions` "New …" button where applicable).
2. Toolbar: `SearchBox` + `<select className="input !w-40">` filter(s); resetting
   `page` to 1 on any change.
3. A `.card overflow-hidden` wrapper containing:
   - `TableSkeleton` while `isLoading`,
   - `EmptyState` when there are no rows (distinct copy for "no data" vs "no match",
     with a create `action` when relevant),
   - otherwise the table.
4. **Shaded table header**: `<tr className="… bg-surface-2 border-b border-edge text-xs">`
   with `font-semibold` header cells.
5. **Horizontal-scroll wrapper**: put wide tables in `overflow-x-auto` (the `.card`
   does this automatically for a direct child `<table>`; use an inner
   `<div className="overflow-x-auto">` when the table isn't a direct child).
6. Money cells: `text-right money`; overdue/unpaid amounts get `text-danger` when
   `due > 0`. Invoice/SKU cells use `.mono`. Status uses `Badge`.
7. `Pagination` at the bottom of the card.

### Every add / edit form
- Rendered in a `wide` `Modal`, body is a stack of **`FormSection`** cards with
  colour-coded icons (details = accent, items = info, charges/payment = success).
- Line-item mini-tables reuse the shaded `bg-surface-2` header inside a
  `rounded-lg border border-edge` wrapper.
- A summary box uses the **`accent-soft`** tint for the grand-total row:
  `style={{ background: "var(--accent-soft)", color: "var(--accent-hover)" }}`.
- Footer actions: `btn-secondary` Cancel + **`btn-primary`** save. Disable + show
  "Saving…" while the mutation is pending.

### Every destructive action
- A named `ConfirmDialog` (or an inline `btn-danger` "Confirm return / delete") that
  states the item/document by name. Never delete financial documents — return/cancel
  flows use `btn-danger`, not `btn-money`.

### Every save
- On success, `toast()` **with the document number** (`INV-…`, `PUR-…`, `PAY-…`),
  then invalidate the relevant TanStack Query keys.

### Charts (keep premium)
- **Recharts** only. Gradient **area fills using `var(--accent)`**, soft grid lines
  on `var(--border)`/`border-edge`, mount animation, and **custom tooltips styled like
  our `.card`**. Never use default Recharts colours. Dashboard set: 30-day sales area,
  category-share donut, top-products bar, receivables-aging stacked bar. Chart series
  draw from the extended accent tokens (teal/cyan/purple/indigo/pink) via `var(--…)`.

---

## 9. Quick do / don't

- ✅ `bg-surface`, `text-ink`, `border-edge`, `text-accent`, `text-danger`, `.money`, `.mono`.
- ✅ One `btn-primary` per view; `btn-money` **only** for cash-confirm actions.
- ✅ Search + filters + skeleton + empty state + shaded header + pagination on every list.
- ❌ Raw hex / `#…` in components. ❌ Green as a generic accent. ❌ Orange on a money-confirm button.
- ❌ Prices in `.mono` (use `.money`). ❌ Default Recharts colours. ❌ A screen that only works in one theme.

---

## History

- **v1 concept** — an early steel-and-amber industrial look (amber accent). *Retired.*
- **Interim** — a bold indigo→violet→fuchsia gradient phase with colourful KPIs. *Retired.*
- **Current** — warm-orange, light-first, Nunito + JetBrains Mono, green reserved for
  money. **This is the active system and the source of truth**; it supersedes all earlier
  naming and fonts.
