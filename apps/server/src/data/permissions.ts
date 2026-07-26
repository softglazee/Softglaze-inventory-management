/**
 * Permission catalog (A2). ~40 keys grouped for the Roles & Permissions matrix.
 * SUPER_ADMIN implicitly holds ALL of these and is never stored/edited here.
 * `default` lists which of the OTHER roles get the permission out of the box —
 * SUPER_ADMIN can retune the matrix later (editor UI lands in Phase 6).
 */
import { PrismaClient, Role } from "@prisma/client";

export type PermissionDef = {
  key: string;
  group: string;
  label: string;
  default: Role[]; // non-super roles that hold this by default
};

const ADMIN = Role.ADMIN;
const MANAGER = Role.MANAGER;
const CASHIER = Role.CASHIER;
const ACCOUNTANT = Role.ACCOUNTANT;

export const PERMISSIONS: PermissionDef[] = [
  // ── Products ──
  { key: "products.view", group: "Products", label: "View products", default: [ADMIN, MANAGER, CASHIER, ACCOUNTANT] },
  { key: "products.create", group: "Products", label: "Add products", default: [ADMIN, MANAGER] },
  { key: "products.edit", group: "Products", label: "Edit products", default: [ADMIN, MANAGER] },
  { key: "products.delete", group: "Products", label: "Delete / deactivate products", default: [ADMIN, MANAGER] },
  { key: "products.import", group: "Products", label: "Import / export products", default: [ADMIN, MANAGER] },
  { key: "products.edit_cost", group: "Products", label: "Manually edit cost price", default: [ADMIN, MANAGER] },

  // ── Sales ──
  { key: "sales.create", group: "Sales", label: "Make sales (POS)", default: [ADMIN, MANAGER, CASHIER] },
  { key: "sales.discount_over_limit", group: "Sales", label: "Discount / edit price beyond limit", default: [ADMIN, MANAGER] },
  { key: "sales.return", group: "Sales", label: "Process sales returns", default: [ADMIN, MANAGER] },
  { key: "sales.view_all", group: "Sales", label: "View everyone's sales", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "sales.view_own", group: "Sales", label: "View own sales", default: [ADMIN, MANAGER, CASHIER, ACCOUNTANT] },

  // ── Purchases ──
  { key: "purchases.view", group: "Purchases", label: "View purchases", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "purchases.create", group: "Purchases", label: "Make purchases", default: [ADMIN, MANAGER] },
  { key: "purchases.edit", group: "Purchases", label: "Edit purchases", default: [ADMIN, MANAGER] },
  { key: "purchases.return", group: "Purchases", label: "Process purchase returns", default: [ADMIN, MANAGER] },

  // ── Customers ──
  { key: "customers.view", group: "Customers", label: "View customers", default: [ADMIN, MANAGER, CASHIER, ACCOUNTANT] },
  { key: "customers.create", group: "Customers", label: "Add customers", default: [ADMIN, MANAGER, CASHIER] },
  { key: "customers.edit", group: "Customers", label: "Edit customers", default: [ADMIN, MANAGER, CASHIER] },
  { key: "customers.delete", group: "Customers", label: "Delete / deactivate customers", default: [ADMIN, MANAGER] },

  // ── Vendors ──
  { key: "vendors.view", group: "Vendors", label: "View vendors", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "vendors.create", group: "Vendors", label: "Add vendors", default: [ADMIN, MANAGER] },
  { key: "vendors.edit", group: "Vendors", label: "Edit vendors", default: [ADMIN, MANAGER] },
  { key: "vendors.delete", group: "Vendors", label: "Delete / deactivate vendors", default: [ADMIN, MANAGER] },

  // ── Money ──
  { key: "payments.receive", group: "Money", label: "Receive customer payments", default: [ADMIN, MANAGER, CASHIER, ACCOUNTANT] },
  { key: "payments.pay_vendor", group: "Money", label: "Pay vendors", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "expenses.view", group: "Money", label: "View expenses", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "expenses.create", group: "Money", label: "Record expenses", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "expenses.edit", group: "Money", label: "Edit / delete expenses", default: [ADMIN, ACCOUNTANT] },
  { key: "accounts.view", group: "Money", label: "View accounts & cash book", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "accounts.manage", group: "Money", label: "Manage accounts, transfers, capital & drawings", default: [ADMIN, ACCOUNTANT] },

  // ── Stock ──
  { key: "stock.adjust", group: "Stock", label: "Adjust stock (damage / count)", default: [ADMIN, MANAGER] },

  // ── Staff ──
  { key: "employees.view", group: "Staff", label: "View employees", default: [ADMIN, MANAGER] },
  { key: "employees.manage", group: "Staff", label: "Manage employees", default: [ADMIN, MANAGER] },
  { key: "salary.pay", group: "Staff", label: "Pay salaries", default: [ADMIN, ACCOUNTANT] },

  // ── Reports ──
  { key: "reports.view", group: "Reports", label: "View reports", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "reports.profit", group: "Reports", label: "See cost & profit figures", default: [ADMIN, MANAGER, ACCOUNTANT] },
  { key: "reports.export", group: "Reports", label: "Export reports (PDF / Excel)", default: [ADMIN, MANAGER, ACCOUNTANT] },

  // ── Administration (mostly SUPER_ADMIN-only) ──
  { key: "users.manage", group: "Administration", label: "Manage users & roles", default: [ADMIN] },
  { key: "settings.shop", group: "Administration", label: "Edit shop profile & settings", default: [ADMIN] },
  { key: "settings.integrations", group: "Administration", label: "Configure integrations (WhatsApp / SMTP)", default: [] },
  { key: "audit.view", group: "Administration", label: "View audit log", default: [ADMIN] },
  { key: "backup.manage", group: "Administration", label: "Backup & restore", default: [] },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

/** The other roles besides SUPER_ADMIN (which is implicit-all and never stored). */
export const EDITABLE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.ACCOUNTANT];

/** Default keys for a role, derived from the catalog. */
export function defaultKeysForRole(role: Role): string[] {
  if (role === Role.SUPER_ADMIN) return [...ALL_PERMISSION_KEYS];
  return PERMISSIONS.filter((p) => p.default.includes(role)).map((p) => p.key);
}

/**
 * Upserts the permission catalog and seeds default RolePermission rows for any
 * (role, key) pairs not already present. Safe to re-run — never removes an
 * admin's customizations, only fills in defaults for new keys.
 */
export async function seedPermissions(prisma: PrismaClient): Promise<void> {
  for (const [i, p] of PERMISSIONS.entries()) {
    await prisma.permission.upsert({
      where: { key: p.key },
      create: { key: p.key, group: p.group, label: p.label, sort: i },
      update: { group: p.group, label: p.label, sort: i },
    });
  }
  const rows = PERMISSIONS.flatMap((p) => p.default.map((role) => ({ role, permissionKey: p.key })));
  await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
}
