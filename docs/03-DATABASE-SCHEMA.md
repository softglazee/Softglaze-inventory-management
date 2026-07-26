# SoftGlaze — Database Guide

The full schema lives in `apps/server/prisma/schema.prisma` (heavily commented — read it).
This is the mental map:

## Entity map

```
User ──┬─ creates ─→ Sale ──── SaleItem ──→ Product ──→ Category / Unit / ProductImage
       ├─ creates ─→ Purchase ─ PurchaseItem ─→ Product
       ├─ creates ─→ Payment ──→ PaymentMethod
       ├─ creates ─→ Expense ──→ ExpenseCategory
       └─ creates ─→ StockAdjustment ── items ──→ Product

Customer ──→ Sales, Payments (balance = receivable)
Vendor   ──→ Purchases, Payments (balance = payable)
Product  ──→ StockMovement (the stock ledger — source of truth)
Setting / Counter / AuditLog = system tables
```

## The money flows (memorize these)

**Cash sale:** Sale(COMPLETED, paid=total) → SaleItems(+cost snapshot) →
StockMovement(SALE, −qty) → Payment(SALE_RECEIPT) → Product.stockQty↓

**Credit sale (udhaar):** same, but dueAmount>0 → Customer.balance ↑ (they owe us)

**Customer pays later:** Payment(CUSTOMER_RECEIPT) → Customer.balance ↓

**Purchase:** Purchase(RECEIVED) → StockMovement(PURCHASE, +qty) →
Product.costPrice = weighted avg → Vendor.balance ↑ (we owe them)

**Pay vendor:** Payment(VENDOR_PAYMENT) → Vendor.balance ↓

**Sale return:** new Sale(isReturn) → StockMovement(SALE_RETURN, +qty) →
refund Payment(REFUND_OUT) or Customer.balance ↓

**Profit & Loss for a period:**
Gross = Σ Sale.grandTotal − Σ returns − Σ Sale.totalCost(COGS)
Net = Gross − Σ Expense.amount

## Rules
- Never edit stockQty directly — always via a StockMovement inside a transaction.
- Never delete completed Sales/Purchases — use CANCELLED status or returns (audit trail).
- Counters (`Counter` table) generate INV-000123 style numbers inside transactions.
- Balances: Customer.balance > 0 = receivable · Vendor.balance > 0 = payable.
