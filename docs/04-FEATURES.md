# SoftGlaze — Complete Feature Specification

Everything the finished product does. Use this as the acceptance checklist.

## 1. Authentication & Users
- Login page (email + password), Register page (first user auto-becomes ADMIN; after that only Admin creates users)
- JWT access token (15 min) + refresh token (7 days, rotated)
- Forgot password → Admin resets from Users screen (no email server needed for a shop)
- User profile: change own password, name, avatar
- Sessions invalidated on password change / disable

### Role Permission Matrix
| Feature | Admin | Manager | Cashier | Accountant |
|---|---|---|---|---|
| POS / create sale | ✅ | ✅ | ✅ | ❌ |
| Give discount above limit | ✅ | ✅ | ❌ | ❌ |
| Sales returns | ✅ | ✅ | ✅ (same day) | ❌ |
| Products / categories CRUD | ✅ | ✅ | 👁 view | 👁 view |
| See cost price & profit | ✅ | ✅ | ❌ | ✅ |
| Purchases / vendors | ✅ | ✅ | ❌ | 👁 view |
| Stock adjustments | ✅ | ✅ | ❌ | ❌ |
| Customer/vendor payments | ✅ | ✅ | ✅ (receive only) | ✅ |
| Expenses | ✅ | ✅ | ❌ | ✅ |
| Reports (all) | ✅ | ✅ | own sales only | ✅ |
| Users & roles | ✅ | ❌ | ❌ | ❌ |
| Settings / backup | ✅ | ❌ | ❌ | ❌ |
| Audit log | ✅ | ❌ | ❌ | ❌ |

## 2. Products & Inventory
- Categories with sub-categories + images (Cement → OPC/SRC; Iron → 10mm/12mm/16mm rods…)
- Units with conversions (Ton↔Kg, Bundle↔Piece)
- Product: SKU (auto: IRN-0001), barcode, multiple images with primary, cost/sale/wholesale prices, tax %, min-stock alert
- Product list: search, filter by category, stock status badges (In Stock / Low / Out), grid & table view with images
- Barcode label printing (later phase, optional)
- Stock is ledger-driven: every change creates a StockMovement row (full traceability)
- Stock adjustment with reasons (damage, count fix, theft) — audit logged
- Low stock dashboard widget + dedicated low-stock report

## 3. Purchasing
- New purchase: pick vendor → add items (search) → qty + cost → charges (freight/loading) → save as RECEIVED
- Auto: stock in, weighted-average cost recalculated, vendor payable increased
- Partial/full payment at purchase time
- Purchase returns (select original bill, return items) → stock out, payable reduced
- Purchase list with filters + view/print

## 4. POS & Sales ⭐
- Fast POS layout: left = product search + category tiles with images; right = cart
- Search by name / SKU / barcode scanner (Enter adds item)
- Line edit: qty, price override (role-gated), line discount
- Bill: discount (₨ or %), tax, delivery/loading charges
- Customer: walk-in default, or search/quick-add customer
- Payments: Cash, Bank, Card, Mobile wallet, **Credit (udhaar)**, and split (e.g. 5,000 cash + rest credit)
- Credit sale blocked if over customer's credit limit (Admin can override)
- Hold bill / resume held bills
- Print: 80mm thermal receipt AND A4 PDF invoice (logo, shop details, terms footer) — auto after save + reprint anytime
- Sales returns against invoice → stock back in, balance/refund handled
- Quotations: save, print PDF, convert to invoice later
- Every sale stores COGS snapshot → per-invoice profit visible instantly (role-gated)

## 5. Customers & Vendors
- Full CRUD with codes (CUS-0001 / VEN-0001), opening balances
- **Customer ledger**: every invoice, return, and payment with running balance → print/PDF statement
- **Vendor ledger**: same for payables
- Receivables aging (0–30 / 31–60 / 61–90 / 90+ days)
- Credit limit warnings at POS
- WhatsApp-ready statement share (PDF) — nice touch for the shop

## 6. Payments & Expenses
- Receive customer payment (against balance or specific invoice), partial allowed
- Pay vendor (against balance or specific purchase)
- Payment methods master (Cash, bank accounts, JazzCash, EasyPaisa, Card)
- Expenses with categories (Rent, Salaries, Electricity, Transport, Misc)
- Daily cash book: opening cash + receipts − payments − expenses = closing
- Day-close summary screen (cashier shift summary)

## 7. Reports (each: screen + PDF + Excel)
1. Sales — by date range / customer / product / category / cashier
2. Purchases — same filters
3. **Profit & Loss** — Sales − Returns − COGS = Gross Profit − Expenses = Net Profit
4. Stock report — current qty, avg cost, stock **valuation** (₨ value of shop inventory)
5. Stock movement ledger per product
6. Receivables (customer dues + aging)
7. Payables (vendor dues)
8. Expense report by category
9. Daily cash book / register report
10. Top products / top customers
- All PDF exports carry shop logo + header; Excel exports are real .xlsx with formatted columns

## 8. Dashboard
- Cards: Today's Sales, Today's Profit, Receivables, Payables, Cash in hand, Low-stock count
- Charts: 30-day sales trend, sales by category (pie), top 5 products
- Recent invoices list, low-stock list
- Everything respects role visibility (cashier doesn't see profit)

## 9. Settings & System
- Shop profile: name, logo upload, address, phones, tax number
- Invoice settings: prefix, footer terms, receipt size (80mm/A4 default), show/hide logo
- Tax % default, currency symbol (₨)
- Backup: one-click DB dump download; Restore from file (Admin)
- Audit log viewer with filters
- Theme: dark / light switcher (persisted per user)

## 10. Non-functional (production-ready bar)
- Input validation on client (zod) + server (zod), consistent error toasts
- All money in Decimal (never float), all stock in Decimal(18,3)
- Every write in a DB transaction (sale = invoice + items + stock moves + payment + balances atomically)
- Helmet, CORS locked, rate limiting on auth, bcrypt(12), audit on sensitive actions
- Responsive: works on shop desktop, laptop, and tablet browser
- Keyboard-first POS, loading skeletons, empty states with guidance
