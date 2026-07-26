/** API entity shapes (Prisma Decimal → string over JSON) */

export type Unit = {
  id: string;
  name: string;
  shortName: string;
  baseUnitId: string | null;
  baseUnit?: { id: string; name: string; shortName: string } | null;
  factor: string;
  _count?: { products: number };
};

export type Category = {
  id: string;
  name: string;
  parentId: string | null;
  parent?: { id: string; name: string } | null;
  image: string | null;
  isActive: boolean;
  _count?: { products: number; children: number };
};

export type ProductImage = {
  id: string;
  productId: string;
  path: string;
  thumbPath: string | null;
  isPrimary: boolean;
  sortOrder: number;
};

export type ProductType = "STANDARD" | "SERVICE" | "COMBO";

export type Brand = {
  id: string;
  name: string;
  image: string | null;
  isActive: boolean;
  _count?: { products: number };
};

export type ComboItemView = {
  id: string;
  componentProductId: string;
  qty: string;
  componentProduct?: { id: string; name: string; sku: string; unit?: { shortName: string } };
};

export type Product = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  type: ProductType;
  categoryId: string;
  category?: { id: string; name: string };
  unitId: string;
  unit?: { id: string; name: string; shortName: string };
  brandId: string | null;
  brand?: { id: string; name: string } | null;
  costPrice: string;
  salePrice: string;
  wholesalePrice: string | null;
  taxPercent: string;
  stockQty: string;
  minStockLevel: string;
  length: string | null;
  width: string | null;
  height: string | null;
  weight: string | null;
  // Weight calculator profile (C1)
  weightCalc?: WeightCalc;
  diameterMm?: string | null;
  thicknessMm?: string | null;
  sheetWidthFt?: string | null;
  pieceLengthFt?: string | null;
  densityKgM3?: string | null;
  isActive: boolean;
  images: ProductImage[];
  comboItems?: ComboItemView[];
};

// C1 — rod/sheet weight calculator
export type WeightCalc = "NONE" | "ROD" | "SHEET";
export type WeightCalcResult = {
  calcType: "ROD" | "SHEET";
  density: number;
  pieces: number;
  totalLengthFt: number;
  totalLengthM: number;
  weightPerFtKg: number;
  weightPerPieceKg: number;
  weightKg: number;
  weightTon: number;
  areaSqft: number;
};

export type Customer = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxNumber: string | null;
  openingBalance: string;
  balance: string;
  creditLimit: string;
  priceGroupId: string | null;
  priceGroup?: { id: string; name: string; discountPercent: string } | null;
  reminderTier?: number;
  loyaltyPoints?: number;
  isActive: boolean;
};

// ── Outreach (Batch E) ──
export type ReminderPlan = { customerId: string; name: string; balance: number; ageDays: number; tier: number; already: number; willSend: boolean; reason: string };

// ── Customer sites / site-wise sub-ledgers (C4) ──
export type CustomerSite = { id: string; customerId: string; name: string; address: string | null; isActive: boolean; createdAt?: string };
export type CustomerSiteBalance = CustomerSite & { balance: number };
export type SiteBalancesView = { sites: CustomerSiteBalance[]; unassigned: number; total: number; customerBalance: number; reconciles: boolean };
export type SiteLedger = { site: CustomerSite; customer: { id: string; code: string; name: string; phone: string | null }; opening: number; closing: number; totalDebit: number; totalCredit: number; entries: { date: string; refNo: string; type: string; description: string; debit: number; credit: number; balance: number }[] };

// ── Price groups (F6) ──
export type PriceGroupItem = { id: string; productId: string; product?: { id: string; name: string; sku: string; salePrice: string }; price: string };
export type PriceGroup = { id: string; name: string; discountPercent: string; sortOrder: number; isActive: boolean; items: PriceGroupItem[]; _count?: { customers: number } };

// ── Rate contracts (C3) ──
export type RateContractStatus = "active" | "upcoming" | "expired" | "inactive";
export type RateContractItem = { id: string; productId: string; product?: { id: string; name: string; sku: string; salePrice: string; unit?: { shortName: string } }; price: string };
export type RateContract = {
  id: string;
  refNo: string;
  customerId: string;
  customer?: { id: string; code: string; name: string; phone: string | null };
  name: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  notes: string | null;
  status: RateContractStatus;
  items: RateContractItem[];
};
export type RateResolution = { rates: { productId: string; price: number }[]; count: number; primary: { id: string; refNo: string; name: string; validFrom: string; validUntil: string } | null };

export type Vendor = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  bankDetails: string | null;
  openingBalance: string;
  balance: string;
  isActive: boolean;
};

export type PaymentMethod = { id: string; name: string; isCash: boolean; isActive: boolean };

export type PurchaseItem = {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string; unit?: { shortName: string } };
  qty: string;
  unitCost: string;
  landedUnitCost?: string | null; // C2 — billed + allocated freight (null = no allocation)
  discount: string;
  total: string;
};
export type LandedBasis = "NONE" | "VALUE" | "QTY";
export type PurchasePayment = { id: string; amount: string; method?: { name: string } };
export type PurchaseStatus = "DRAFT" | "RECEIVED" | "RETURNED" | "CANCELLED";
export type Purchase = {
  id: string;
  invoiceNo: string;
  vendorId: string;
  vendor?: { id: string; code: string; name: string; phone?: string | null };
  user?: { id: string; name: string };
  refInvoiceNo: string | null;
  date: string;
  status: PurchaseStatus;
  subTotal: string;
  discount: string;
  tax: string;
  otherCharges: string;
  landedBasis?: LandedBasis; // C2 — how otherCharges was capitalised into item cost
  grandTotal: string;
  paidAmount: string;
  dueAmount: string;
  notes: string | null;
  isReturn: boolean;
  returnOfId: string | null;
  items: PurchaseItem[];
  payments?: PurchasePayment[];
};

export type SaleStatus = "DRAFT" | "COMPLETED" | "RETURNED" | "CANCELLED" | "QUOTATION";
export type SaleItem = {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string; type: ProductType; unit?: { shortName: string } };
  qty: string;
  unitPrice: string;
  unitCost?: string;
  discount: string;
  taxAmount: string;
  total: string;
};
export type SalePayment = { id: string; amount: string; method?: { name: string } };
export type Sale = {
  id: string;
  invoiceNo: string;
  customerId: string | null;
  customer?: { id: string; code: string; name: string; phone: string | null } | null;
  siteId?: string | null;
  site?: { id: string; name: string } | null;
  user?: { id: string; name: string };
  date: string;
  status: SaleStatus;
  subTotal: string;
  discount: string;
  tax: string;
  otherCharges: string;
  roundOff?: string;
  grandTotal: string;
  paidAmount: string;
  dueAmount: string;
  totalCost?: string;
  profit?: string;
  notes: string | null;
  isReturn: boolean;
  returnOfId: string | null;
  items: SaleItem[];
  payments?: SalePayment[];
};

export type StockMoveType =
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "SALE"
  | "SALE_RETURN"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "DAMAGE"
  | "OPENING";
export type StockMovement = {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string; unit?: { shortName: string } };
  type: StockMoveType;
  qty: string;
  unitCost: string | null;
  refType: string | null;
  refId: string | null;
  balance: string;
  date: string;
  notes: string | null;
};
export type StockAdjustmentItem = {
  id: string;
  productId: string;
  product?: { name: string; sku: string; unit?: { shortName: string } };
  qtyChange: string;
};
// B1+B2 — day close / cash count
export type DayClose = {
  id: string;
  refNo: string;
  businessDate: string;
  user?: { name: string };
  openingFloat: string;
  expectedCash: string;
  countedCash: string;
  variance: string;
  cashIn: string;
  cashOut: string;
  denominations: string | null;
  notes: string | null;
  createdAt: string;
};
export type DayClosePreview = { expectedCash: number; cashIn: number; cashOut: number; suggestedFloat: number; cashAccounts: { id: string; name: string; currentBalance: string }[] };

// A4 — promise-to-pay
export type PaymentPromise = {
  id: string;
  customerId: string;
  customer?: { id: string; code: string; name: string; phone: string | null; balance: string };
  amount: string;
  promiseDate: string;
  note: string | null;
  status: "OPEN" | "KEPT" | "BROKEN" | "CANCELLED";
  user?: { name: string };
};
export type PromiseSummary = { open: number; overdue: number; openAmount: string | number };

export type StockAdjustment = {
  id: string;
  refNo: string;
  reasonCode: string;
  reason: string;
  date: string;
  user?: { name: string };
  items: StockAdjustmentItem[];
};

// ── Money accounts (G1) ──
export type Account = {
  id: string;
  name: string;
  isCash: boolean;
  isActive: boolean;
  accountNo: string | null;
  bankName: string | null;
  openingBalance: string;
  currentBalance: string;
  sortOrder: number;
};

export type AccountEntryType = "PAYMENT" | "TRANSFER_IN" | "TRANSFER_OUT" | "CAPITAL_IN" | "DRAWING" | "OPENING";
export type AccountEntry = {
  id: string;
  accountId: string;
  type: AccountEntryType;
  amount: string;
  balance: string;
  running?: string;
  refType: string | null;
  refId: string | null;
  date: string;
  notes: string | null;
};

export type FundTransfer = {
  id: string;
  refNo: string;
  fromAccountId: string;
  toAccountId: string;
  fromAccount?: { name: string };
  toAccount?: { name: string };
  amount: string;
  date: string;
  notes: string | null;
  user?: { name: string };
};

export type CapitalDirection = "CAPITAL_IN" | "DRAWING";
export type CapitalEntry = {
  id: string;
  refNo: string;
  direction: CapitalDirection;
  accountId: string;
  account?: { name: string };
  amount: string;
  date: string;
  notes: string | null;
  user?: { name: string };
};

export type PaymentType =
  | "SALE_RECEIPT" | "CUSTOMER_RECEIPT" | "PURCHASE_PAYMENT" | "VENDOR_PAYMENT" | "EXPENSE" | "REFUND_OUT" | "REFUND_IN";
export type Payment = {
  id: string;
  refNo: string;
  type: PaymentType;
  amount: string;
  date: string;
  notes: string | null;
  method?: { name: string };
  customer?: { id: string; code: string; name: string } | null;
  vendor?: { id: string; code: string; name: string } | null;
};

// ── Cheques (F1) ──
export type ChequeStatus = "PENDING" | "CLEARED" | "BOUNCED" | "CANCELLED";
export type Cheque = {
  id: string;
  refNo: string;
  direction: "RECEIVED" | "ISSUED";
  customer?: { id: string; code: string; name: string; phone: string | null } | null;
  vendor?: { id: string; code: string; name: string; phone: string | null } | null;
  bankName: string;
  chequeNo: string;
  amount: string;
  chequeDate: string;
  status: ChequeStatus;
  settledAccountId: string | null;
  clearedAt: string | null;
  notes: string | null;
  createdAt: string;
};
export type ChequeSummary = { groups: { direction: string; status: string; count: number; amount: string }[]; dueSoon: number };

// ── Delivery challans (F2) ──
export type DeliveryNote = {
  id: string;
  refNo: string;
  saleId: string;
  date: string;
  driverName: string | null;
  vehicleNo: string | null;
  receiverName: string | null;
  notes: string | null;
  status: "DELIVERED" | "CANCELLED";
  tripId?: string | null;
  sale?: { id: string; invoiceNo: string; date: string; customer?: { name: string; phone: string | null } | null };
  user?: { name: string };
  items: { id: string; saleItemId: string; qty: string; saleItem?: { product?: { name: string; sku: string; unit?: { shortName: string } } } }[];
};
export type DeliveryPending = {
  sale: { id: string; invoiceNo: string; customer: string };
  lines: { saleItemId: string; product: string; sku: string; unit: string; sold: number; delivered: number; remaining: number }[];
};

// ── Delivery trips / freight billing (C5) ──
export type DeliveryTrip = {
  id: string;
  refNo: string;
  date: string;
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  customerId: string | null;
  customer?: { id: string; code: string; name: string; phone: string | null } | null;
  freightCharged: string;
  freightPaid: string;
  expenseId: string | null;
  expense?: { id: string; refNo: string } | null;
  notes: string | null;
  user?: { name: string };
  challans: { id: string; refNo: string; sale?: { invoiceNo: string; customer?: { name: string } | null } }[];
  margin: number;
};
export type DeliveryTripTotals = { charged: number; paid: number; margin: number };

// ── Advance bookings (F3) ──
export type BookingStatus = "OPEN" | "PARTIAL" | "COMPLETED" | "CANCELLED";
export type BookingItem = {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string; type: ProductType; salePrice: string; unit?: { shortName: string } };
  qty: string;
  unitPrice: string;
  qtyFulfilled: string;
};
export type Booking = {
  id: string;
  refNo: string;
  customerId: string;
  customer?: { id: string; code: string; name: string; phone: string | null };
  date: string;
  validUntil: string | null;
  status: BookingStatus;
  bookedValue: string;
  advanceReceived: string;
  notes: string | null;
  user?: { id: string; name: string };
  items: BookingItem[];
  sales?: { id: string; invoiceNo: string; date: string; grandTotal: string; status: string; isReturn: boolean }[];
  // server-computed
  valueFulfilled: number;
  advanceRemaining: number;
  outstanding: number;
};
export type BookingSummary = { openCount: number; advancesHeld: number; outstandingValue: number };

// ── Construction estimator (F4) ──
export type EstimatorItem = {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string; salePrice: string; isActive: boolean; unit?: { shortName: string } };
  qtyPerUnit: string;
  note: string | null;
  sortOrder: number;
};
export type EstimatorTemplate = {
  id: string;
  name: string;
  description: string | null;
  areaLabel: string;
  multiplyByFloors: boolean;
  sortOrder: number;
  isActive: boolean;
  items: EstimatorItem[];
};
export type EstimatorPreset = { key: string; name: string; description: string; areaLabel: string; multiplyByFloors: boolean; rows: { label: string; unitHint: string; qtyPerUnit: number }[] };
export type EstimateLine = { productId: string; name: string; sku: string; unit: string; active: boolean; note: string | null; qtyPerUnit: number; qty: number; unitPrice: number; lineTotal: number };
export type EstimateResult = { template: { id: string; name: string; areaLabel: string; multiplyByFloors: boolean }; area: number; floors: number; totalUnits: number; lines: EstimateLine[]; grandTotal: number };

// ── Ledgers / statements ──
export type LedgerEntry = { date: string; refNo: string; type: string; description: string; debit: number; credit: number; balance: number };
export type CustomerLedger = { customer: Customer; balance: string; opening: number; closing: number; totalDebit: number; totalCredit: number; entries: LedgerEntry[] };
export type VendorLedger = { vendor: Vendor; balance: string; opening: number; closing: number; totalDebit: number; totalCredit: number; entries: LedgerEntry[] };
export type AccountStatement = { account: Account; opening: string; closing: string; totalIn: string; totalOut: string; entries: AccountEntry[] };

// ── Expenses ──
export type ExpenseCategory = { id: string; name: string; _count?: { expenses: number } };
export type Expense = {
  id: string;
  refNo: string;
  categoryId: string;
  category?: { id: string; name: string };
  amount: string;
  date: string;
  notes: string | null;
  user?: { name: string };
  payment?: { id: string; method?: { name: string } } | null;
  recurringId?: string | null;
};

export type RecurringExpense = {
  id: string;
  categoryId: string;
  category?: { id: string; name: string };
  methodId: string;
  method?: { id: string; name: string };
  amount: string;
  dayOfMonth: number;
  notes: string | null;
  isActive: boolean;
  lastPostedPeriod: string | null;
  _count?: { generated: number };
};

// ── Employees & salaries ──
export type Department = { id: string; name: string; _count?: { employees: number } };
export type Shift = { id: string; name: string; startTime: string; endTime: string; _count?: { employees: number } };
export type SalaryPayment = {
  id: string;
  refNo: string;
  employeeId: string;
  employee?: { id: string; code: string; name: string };
  month: string;
  baseAmount: string;
  bonus: string;
  deduction: string;
  absentDeduction: string;
  advanceRecovered: string;
  netPaid: string;
  date: string;
  notes: string | null;
  user?: { name: string };
};

// ── Attendance & staff advances (F5) ──
export type AttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE";
export type Attendance = { id: string; employeeId: string; employee?: { id: string; code: string; name: string }; date: string; status: AttendanceStatus; note: string | null };
export type AttendanceSummaryRow = { employeeId: string; code: string; name: string; present: number; absent: number; half: number; leave: number };
export type AttendanceSummary = { month: string; daysInMonth: number; rows: AttendanceSummaryRow[] };
export type EmployeeAdvance = {
  id: string;
  refNo: string;
  employeeId: string;
  amount: string;
  date: string;
  notes: string | null;
  method?: { name: string };
  recoveredInId: string | null;
  recoveredIn?: { refNo: string; month: string } | null;
};
export type SalaryPreview = {
  month: string;
  base: number;
  daysInMonth: number;
  perDay: number;
  attendance: { present: number; absent: number; half: number; leave: number };
  suggestedAbsentDeduction: number;
  openAdvances: { id: string; refNo: string; amount: string; date: string }[];
  openAdvanceTotal: number;
  alreadyPaid: string | null;
};
export type Employee = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  cnic: string | null;
  address: string | null;
  designation: string | null;
  photo: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  shiftId: string | null;
  shift?: { id: string; name: string } | null;
  joinDate: string;
  baseSalary: string;
  isActive: boolean;
  notes: string | null;
  salaries?: SalaryPayment[];
};
export type LeaveType = "PAID" | "UNPAID" | "SICK";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";
export type LeaveRequest = {
  id: string;
  employeeId: string;
  employee?: { id: string; code: string; name: string };
  fromDate: string;
  toDate: string;
  days: number;
  type: LeaveType;
  status: LeaveStatus;
  reason: string | null;
  approver?: { name: string } | null;
};
export type Holiday = { id: string; date: string; name: string };

// ── Reports ──
export type CashbookRow = { accountId: string; name: string; isCash: boolean; opening: string; moneyIn: string; moneyOut: string; closing: string };
export type Cashbook = { from: string; to: string; rows: CashbookRow[]; totals: { opening: string; moneyIn: string; moneyOut: string; closing: string } };
export type BalanceSheet = {
  assets: { cashBank: string; stockValue: string; receivables: string; vendorAdvances: string; employeeAdvances: string; total: string };
  liabilities: { payables: string; customerAdvances: string; total: string };
  equity: { capital: string; openingStock: string; openingBalances: string; drawings: string; retainedEarnings: string; total: string };
  imbalance: number;
};
export type IntegrityCheck = { name: string; ok: boolean; detail: string };
export type IntegrityReport = { allGreen: boolean; checks: IntegrityCheck[]; balanceSheet: BalanceSheet };

// ── Generic report table (JSON that also drives PDF/Excel) ──
export type ReportColumn = { header: string; key: string; align?: "left" | "right"; money?: boolean };
export type ReportTable = {
  title: string;
  subtitle?: string;
  meta?: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
};

// ── Dashboard ──
export type DashboardData = {
  cards: {
    todaySales: string; monthSales: string; receivables: string; payables: string; cash: string; lowStock: number;
    salesReturn: string; totalPurchase: string; purchaseReturn: string; expenses: string; todayOrders: number;
    todayProfit?: string; monthProfit?: string;
  };
  counts: { suppliers: number; customers: number; orders: number; categories: number; products: number };
  customersOverview: { firstTime: number; returning: number };
  salesSeries: { date: string; sales: number; purchase: number; profit?: number }[];
  categoryShare: { name: string; value: number }[];
  topProducts: { name: string; value: number; qty: number; image: string | null }[];
  topCustomers: { name: string; bills: number; sales: number }[];
  revenueExpense: { month: string; revenue: number; expense: number }[];
  heatmap: number[][];
  recentSales: { id: string; invoiceNo: string; date: string; customer: string; grandTotal: string; dueAmount: string }[];
  lowStockItems: { id: string; name: string; sku: string; stockQty: number; minStockLevel: number; unit: string; image: string | null }[];
  canProfit: boolean;
};

// ── Admin (Phase 6) ──
export type ManagedUser = { id: string; name: string; email: string; phone: string | null; role: string; isActive: boolean; commissionPercent?: string; createdAt: string };
export type AppNotification = { id: string; type: string; title: string; message: string; entity: string | null; entityId: string | null; isRead: boolean; createdAt: string };
export type MessageLogEntry = { id: string; channel: "WHATSAPP" | "EMAIL"; recipient: string; template: string; refType: string | null; refId: string | null; status: string; error: string | null; createdAt: string };
export type AuditLogEntry = { id: string; action: string; entity: string | null; entityId: string | null; details: string | null; ip: string | null; createdAt: string; user?: { name: string } | null };
export type PermissionDef = { key: string; group: string; label: string; sort?: number };
export type PermissionMatrix = { permissions: PermissionDef[]; roles: string[]; matrix: Record<string, string[]> };

export type BusinessPresetInfo = {
  key: string;
  label: string;
  description: string;
  categoryNames: string[];
  unitNames: string[];
};

export type Paged<T extends string, V> = { total: number; page: number; pages: number } & Record<T, V[]>;

// ── Cutting & offcuts (C6) ──
export type CutOutputKind = "PIECE" | "OFFCUT";
export type CuttingOutput = {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string; unit?: { shortName: string } };
  kind: CutOutputKind;
  qty: string;
  lengthFt: string | null;
  unitCost: string;
};
export type CuttingJob = {
  id: string;
  number: string;
  date: string;
  sourceProductId: string;
  sourceProduct?: { id: string; name: string; sku: string; unit?: { shortName: string } };
  sourceQty: string;
  sourceUnitCost: string;
  wastageQty: string;
  totalCost: string;
  notes: string | null;
  user?: { name: string };
  outputs: CuttingOutput[];
};

// ── Vendor debit/credit notes (D4) ──
export type VendorNoteType = "CREDIT" | "DEBIT";
export type VendorNote = {
  id: string;
  refNo: string;
  vendorId: string;
  vendor?: { id: string; code: string; name: string };
  type: VendorNoteType;
  amount: string;
  reason: string;
  date: string;
  user?: { name: string };
};

// ── Purchase orders → GRN (D5) ──
export type PurchaseOrderStatus = "DRAFT" | "SENT" | "PARTIAL" | "RECEIVED" | "CLOSED" | "CANCELLED";
export type PurchaseOrderItem = {
  id: string;
  productId: string;
  product?: { id: string; name: string; sku: string; unit?: { shortName: string } };
  qty: string;
  qtyReceived: string;
  unitCost: string;
};
export type PurchaseOrder = {
  id: string;
  poNo: string;
  vendorId: string;
  vendor?: { id: string; code: string; name: string };
  user?: { name: string };
  date: string;
  expectedDate: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  items: PurchaseOrderItem[];
  purchases: { id: string; invoiceNo: string; date: string; grandTotal: string }[];
};
