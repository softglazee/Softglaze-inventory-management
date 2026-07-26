# SoftGlaze — API Reference (target surface)

Base URL: `/api/v1` · Auth: `Authorization: Bearer <token>` · Roles in brackets.
Standard list params: `?page&limit&search&sort&from&to`

## Auth
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | /auth/register | public (first user only → ADMIN) | later: 403, Admin creates users |
| POST | /auth/login | public | returns { user, accessToken, refreshToken } |
| POST | /auth/refresh | public | rotate refresh token |
| POST | /auth/logout | any | invalidates refresh token |
| GET  | /auth/me | any | current user |
| PATCH| /auth/me/password | any | change own password |

## Users [ADMIN]
CRUD: `GET/POST /users`, `GET/PATCH /users/:id`, `PATCH /users/:id/status`, `PATCH /users/:id/reset-password`

## Master data
- `GET/POST/PATCH/DELETE /categories` [write: ADMIN, MANAGER]
- `GET/POST/PATCH/DELETE /units` [ADMIN, MANAGER]
- `GET/POST/PATCH/DELETE /products` · `GET /products/:id` · `GET /products/low-stock`
- `POST /products/:id/images` (multipart) · `DELETE /products/:id/images/:imageId` · `PATCH .../primary`
- `GET /products/search?q=` — POS fast search (name/sku/barcode)

## Customers & Vendors
- `GET/POST/PATCH /customers` · `GET /customers/:id/ledger` · `GET /customers/:id/statement.pdf`
- `GET/POST/PATCH /vendors` · `GET /vendors/:id/ledger` · `GET /vendors/:id/statement.pdf`

## Purchases [ADMIN, MANAGER]
- `GET/POST /purchases` · `GET /purchases/:id` · `POST /purchases/:id/return`
- `GET /purchases/:id/invoice.pdf`

## Sales / POS [ADMIN, MANAGER, CASHIER]
- `POST /sales` — the big transactional endpoint (items, discounts, payments[])
- `GET /sales` · `GET /sales/:id` · `POST /sales/:id/return`
- `POST /sales/hold` · `GET /sales/held` · `DELETE /sales/held/:id`
- `POST /quotations` · `POST /quotations/:id/convert`
- `GET /sales/:id/receipt.pdf?size=80mm|a4`

## Payments & Expenses
- `POST /payments/customer-receipt` [A,M,C,ACC] · `POST /payments/vendor-payment` [A,M,ACC]
- `GET /payments` · `GET/POST /payment-methods` [ADMIN]
- `GET/POST/PATCH /expenses` [A,M,ACC] · `GET/POST /expense-categories`

## Stock
- `GET /stock/movements?productId&from&to`
- `POST /stock/adjustments` [ADMIN, MANAGER] · `GET /stock/adjustments`
- `POST /stock/recalculate` [ADMIN] — rebuild cached stockQty from ledger

## Reports (each supports `.pdf` and `.xlsx` suffix)
- `GET /reports/dashboard` — cards + charts data
- `GET /reports/sales` · `/reports/purchases` · `/reports/profit-loss`
- `GET /reports/stock` (valuation) · `/reports/stock-movements`
- `GET /reports/receivables` (aging) · `/reports/payables`
- `GET /reports/expenses` · `/reports/cash-book` · `/reports/top-products`
Example: `GET /reports/profit-loss.xlsx?from=2026-06-01&to=2026-06-30`

## System
- `GET/PATCH /settings` [ADMIN] · `POST /settings/logo`
- `GET /audit-logs` [ADMIN]
- `GET /backup/download` [ADMIN] · `POST /backup/restore` [ADMIN]
- `GET /health` — used by Electron to know the server is up

## Response shape
```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "INSUFFICIENT_STOCK", "message": "Sariya 12mm has only 40 kg in stock" } }
```
Error codes we standardize early: VALIDATION, UNAUTHORIZED, FORBIDDEN, NOT_FOUND,
INSUFFICIENT_STOCK, CREDIT_LIMIT_EXCEEDED, DUPLICATE, CONFLICT, SERVER_ERROR.
