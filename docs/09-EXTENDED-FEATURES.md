# SoftGlaze — Extended Features (v2 requirements)

Additions on top of `04-FEATURES.md`. Same quality bar, same accounting rules.

## 1. Business Type presets (any-business support)
The core engine (products, categories, units, stock, sales, purchases, ledgers) is
generic. "Business Type" only controls the starter data + small terminology touches.

- Chosen during first-run onboarding (after owner registers) and changeable by SUPER_ADMIN in Settings.
- Presets seed: category tree + typical units + sample products (marked `isSample` in name so they're easy to delete):
  | Preset | Example categories | Typical units |
  |---|---|---|
  | Building Materials (default) | Cement, Sariya 10/12/16/20mm, Windows, Doors, Pipes, Sand & Crush, Hardware | bag, kg, ton, ft, sqft, pc, bundle |
  | Kiryana / General Store | Grocery, Beverages, Snacks, Cleaning, Dairy | pc, kg, g, ltr, dozen, carton |
  | Electronics | Mobiles, Accessories, Home Appliances, Repair Parts | pc, set |
  | Clothing | Gents, Ladies, Kids, Unstitched, Accessories | pc, meter, suit |
  | Pharmacy | Tablets, Syrups, Surgical, Cosmetics | pc, strip, box, bottle |
  | Hardware & Paint | Tools, Fasteners, Paint, Plumbing, Electrical | pc, kg, ltr, box |
  | Custom | empty — owner builds their own | pc, kg |
- Implementation: `apps/server/src/data/business-presets.ts` + `POST /settings/apply-preset` (SUPER_ADMIN, refuses if real transactions already exist unless `force`).

## 2. Employees & Salaries (HR-lite)
- Employee profiles: code (EMP-0001), name, phone, CNIC, address, designation, photo, join date, base monthly salary, active flag, notes.
- Salary payment flow: pick employee → month (2026-07) → base auto-filled → bonus / deduction (advance recovery) → net → payment method. **Atomically creates**: SalaryPayment + Expense (category "Salaries") + Payment(EXPENSE) → so P&L and cash book stay correct with zero extra work.
- Guard: one salary per employee per month (`@@unique([employeeId, month])`) — paying twice is blocked with a clear message.
- Screens: Employees list (photo cards + table), Employee detail (profile + salary history), Pay Salary modal, Salary report (by month, by employee → PDF/Excel).
- Optional link Employee↔User account (an employee who also logs in).

## 3. Expenses (incl. miscellaneous)
Already in v1 scope — reinforce: quick-add expense (2 clicks from anywhere), categories incl. **Miscellaneous**, Rent, Salaries (auto), Electricity, Transport & Loading, Repairs, Tea & Misc. Monthly expense report with category donut chart. Every expense reduces Net Profit for its date's period.

## 4. Notifications & Reminders
**In-app bell** (header, unread badge) fed by server checks:
- LOW_STOCK — product crossed `minStockLevel` (checked after every stock write + daily sweep)
- DEBT_REMINDER — customer receivable older than X days (X in Settings, default 30) or above amount Y
- PAYABLE_REMINDER — vendor due date approaching (optional due-date on purchases)
- CREDIT_LIMIT — customer crossed limit at POS (also blocks per role rules)
- SYSTEM — backup succeeded/failed, integration errors
Daily sweep: node-cron job in the server (runs in both desktop & VPS modes).
Notification center page: filter by type, mark read, jump to the entity.
Reminder actions: from a DEBT_REMINDER, one click → WhatsApp reminder message to that customer (logged in MessageLog).

## 5. Messaging — WhatsApp + SMTP (SUPER_ADMIN → Settings → Integrations)
**WhatsApp v1 — wa.me deep links (free, works today, no approval):**
- After each sale/purchase, show "Send on WhatsApp" (and auto-open if enabled): builds `https://wa.me/<92XXXXXXXXXX>?text=<receipt summary>` — shop name, invoice no, items count, total, paid, balance, thank-you line (template editable in Settings). PDF can be shared via the OS share/print dialog.
- Same for debt reminders and ledger statements.
**WhatsApp v2 — Cloud API (automated, later):** Meta WhatsApp Business Cloud API with approved templates; config fields (token, phone id, templates) ready in Settings but feature-flagged.
**Email (SMTP):** nodemailer; Settings fields: host, port, secure, user, pass (encrypted at rest), from-name. Uses: invoice PDF to customer email, daily sales summary to owner, backup notifications. "Send test email" button.
**Every send** (either channel) → `MessageLog` row with status; a Messages screen shows history + failures.
Phone normalization helper for Pakistan: `0300…` → `92300…`.

## 6. Calculator
- Global calculator widget: header button + hotkey (F12 or Ctrl+K → "calc"), draggable panel, keyboard-driven, memory keys, and a "push to POS" button that inserts the result into the focused qty/price/discount field. Works on every screen; critical inside POS.

## 7. Branding, header/footer & global settings (SUPER_ADMIN)
- Shop logo upload → appears on app sidebar, login page, all PDFs (invoices, statements, reports).
- Invoice header lines (shop name, address, phones, tax no) + footer (terms, Urdu line optional) — live preview while editing.
- Global: currency symbol, tax default, date format, receipt size (80mm/A4), low-stock day sweep time, debt-reminder rules, theme default.
- SUPER_ADMIN is the first registered account; can promote another user to ADMIN; only SUPER_ADMIN sees Integrations, Business Type, Backup/Restore, and can edit global settings.

## 8. Pay-later (udhaar) correctness — both directions
Already core in the schema; the acceptance tests that must pass:
1. Credit sale ₨50,000 (cost ₨41,000) with ₨10,000 cash: revenue 50,000 counted today, profit 9,000 today, customer balance +40,000, cash +10,000. P&L unchanged when he pays later; only cash book and his balance move.
2. Pay-later purchase from vendor ₨300,000: stock & avg cost update today, vendor balance +300,000, zero cash movement, zero P&L effect (COGS hits P&L only as items sell).
3. Partial payments both ways keep `paid + due == grandTotal` always.
4. Returns reverse stock, balances, and profit exactly.
5. `GET /reports/integrity` all-green after any random sequence of the above.

## 9. Where these land in the build plan
- Phase 1: business presets + branding settings foundation
- Phase 4: expenses (v1) + **Employees & Salaries** + calculator
- Phase 5: premium charts + all reports
- Phase 6: SUPER_ADMIN settings, Integrations (SMTP + WhatsApp v1), Notifications & reminders center
- Phase 7–8: installer + server, WhatsApp v2 flag stays off until Meta setup
