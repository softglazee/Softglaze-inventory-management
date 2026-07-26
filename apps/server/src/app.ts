import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.routes";
import unitRoutes from "./routes/units.routes";
import categoryRoutes from "./routes/categories.routes";
import settingRoutes from "./routes/settings.routes";
import productRoutes from "./routes/products.routes";
import customerRoutes from "./routes/customers.routes";
import customerSiteRoutes from "./routes/customer-sites.routes";
import vendorRoutes from "./routes/vendors.routes";
import priceGroupRoutes from "./routes/price-groups.routes";
import rateContractRoutes from "./routes/rate-contracts.routes";
import brandRoutes from "./routes/brands.routes";
import permissionRoutes from "./routes/permissions.routes";
import importRoutes from "./routes/import.routes";
import purchaseRoutes from "./routes/purchases.routes";
import purchaseOrderRoutes from "./routes/purchase-orders.routes";
import vendorNoteRoutes from "./routes/vendor-notes.routes";
import stockRoutes from "./routes/stock.routes";
import cuttingJobRoutes from "./routes/cutting-jobs.routes";
import paymentMethodRoutes from "./routes/payment-methods.routes";
import saleRoutes from "./routes/sales.routes";
import accountRoutes from "./routes/accounts.routes";
import paymentRoutes from "./routes/payments.routes";
import chequeRoutes from "./routes/cheques.routes";
import deliveryRoutes from "./routes/deliveries.routes";
import deliveryTripRoutes from "./routes/delivery-trips.routes";
import bookingRoutes from "./routes/bookings.routes";
import estimatorRoutes from "./routes/estimator.routes";
import ledgerRoutes from "./routes/ledger.routes";
import toolsRoutes from "./routes/tools.routes";
import promiseRoutes from "./routes/promises.routes";
import dayCloseRoutes from "./routes/day-close.routes";
import expenseRoutes from "./routes/expenses.routes";
import employeeRoutes from "./routes/employees.routes";
import attendanceRoutes from "./routes/attendance.routes";
import hrRoutes from "./routes/hr.routes";
import reportRoutes from "./routes/reports.routes";
import userRoutes from "./routes/users.routes";
import notificationRoutes from "./routes/notifications.routes";
import messageRoutes from "./routes/messages.routes";
import outreachRoutes from "./routes/outreach.routes";
import auditRoutes from "./routes/audit.routes";
import backupRoutes from "./routes/backup.routes";
import savedFilterRoutes from "./routes/saved-filters.routes";

const app = express();

// CSP is disabled because in desktop/single-origin mode Express serves the SPA, which
// relies on inline styles (charts, dynamic colours). Other helmet protections stay on.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" })); // large enough for backup/restore snapshots

// Product images etc. (path.resolve so an absolute UPLOAD_DIR from the desktop app is honoured)
app.use("/uploads", express.static(path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads")));

// Protect auth endpoints from brute force
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true });

app.get("/api/v1/health", (_req, res) => res.json({ ok: true, data: { status: "up", ts: Date.now() } }));

app.use("/api/v1/auth", authLimiter, authRoutes);

// ── Module routes (mounted as each phase lands) ──
app.use("/api/v1/units", unitRoutes);            // Phase 1
app.use("/api/v1/categories", categoryRoutes);   // Phase 1
app.use("/api/v1/settings", settingRoutes);      // Phase 1 (presets) — grows in Phase 6
app.use("/api/v1/products", productRoutes);      // Phase 1
app.use("/api/v1/customers", customerRoutes);    // Phase 1
app.use("/api/v1/customer-sites", customerSiteRoutes); // C4 (site-wise sub-ledgers)
app.use("/api/v1/vendors", vendorRoutes);        // Phase 1
app.use("/api/v1/price-groups", priceGroupRoutes); // F6 (customer price groups)
app.use("/api/v1/rate-contracts", rateContractRoutes); // C3 (contractor rate contracts)
app.use("/api/v1/brands", brandRoutes);          // Phase 1 (G2)
app.use("/api/v1/permissions", permissionRoutes);// Phase 1 (A2 foundation)
app.use("/api/v1/import", importRoutes);          // Phase 1 (A3 + G7)
app.use("/api/v1/purchases", purchaseRoutes);    // Phase 2
app.use("/api/v1/purchase-orders", purchaseOrderRoutes); // D5 (PO → GRN flow)
app.use("/api/v1/vendor-notes", vendorNoteRoutes);       // D4 (vendor debit/credit notes)
app.use("/api/v1/stock", stockRoutes);           // Phase 2
app.use("/api/v1/cutting-jobs", cuttingJobRoutes); // C6 (rod/pipe cutting & offcut tracking)
app.use("/api/v1/payment-methods", paymentMethodRoutes); // Phase 2 (read-only list)
app.use("/api/v1/sales", saleRoutes);            // Phase 3
app.use("/api/v1/accounts", accountRoutes);      // Phase 4 (G1 accounts, transfers, capital)
app.use("/api/v1/payments", paymentRoutes);      // Phase 4 (customer receipts, vendor payments)
app.use("/api/v1/day-close", dayCloseRoutes);    // B1+B2 (cash count + day-close / Z-report)
app.use("/api/v1/cheques", chequeRoutes);        // F1 (post-dated cheque register)
app.use("/api/v1/deliveries", deliveryRoutes);   // F2 (delivery challans)
app.use("/api/v1/delivery-trips", deliveryTripRoutes); // C5 (vehicle/trip & freight billing)
app.use("/api/v1/bookings", bookingRoutes);      // F3 (advance bookings with rate lock)
app.use("/api/v1/estimator", estimatorRoutes);   // F4 (construction material estimator)
app.use("/api/v1/ledger", ledgerRoutes);         // Phase 4 (customer & vendor statements)
app.use("/api/v1/tools", toolsRoutes);           // C1 (rod/sheet weight & length calculator)
app.use("/api/v1/promises", promiseRoutes);      // A4 (promise-to-pay collections tracking)
app.use("/api/v1/expenses", expenseRoutes);      // Phase 4
app.use("/api/v1/employees", employeeRoutes);    // Phase 4 (employees & salaries)
app.use("/api/v1/attendance", attendanceRoutes); // F5 (attendance)
app.use("/api/v1/hr", hrRoutes);                 // Phase 4 (G6 departments/shifts/leaves/holidays)
app.use("/api/v1/reports", reportRoutes);        // Phase 4 slice + Phase 5 reports
app.use("/api/v1/users", userRoutes);            // Phase 6 (users & roles)
app.use("/api/v1/notifications", notificationRoutes); // Phase 6 (bell + reminders)
app.use("/api/v1/messages", messageRoutes);      // Phase 6 (WhatsApp/email log)
app.use("/api/v1/outreach", outreachRoutes);     // Batch E (statements, campaigns, reminders)
app.use("/api/v1/audit", auditRoutes);           // Phase 6 (audit log viewer)
app.use("/api/v1/backup", backupRoutes);         // Phase 6 (backup / restore) + H1 cloud upload
app.use("/api/v1/saved-filters", savedFilterRoutes); // H2 (saved report filter presets)

/**
 * Serve the built web app on the same origin (Phase 7 desktop mode + optional single-
 * origin server mode). Enabled by SERVE_WEB=1 or NODE_ENV=production when the build
 * exists. SPA routes fall back to index.html; /api and /uploads are left untouched.
 */
const webDist = path.resolve(process.env.WEB_DIST ?? path.join(process.cwd(), "../web/dist"));
if ((process.env.SERVE_WEB === "1" || process.env.NODE_ENV === "production") && fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
  console.log(`🖥️  Serving web app from ${webDist}`);
}

// 404 + error handler
app.use((_req, res) => res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Route not found" } }));
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({
    ok: false,
    error: { code: err.code ?? "SERVER_ERROR", message: err.message ?? "Something went wrong" },
  });
});

export default app;
