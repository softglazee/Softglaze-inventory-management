import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { NavLink, Outlet, Navigate, useLocation, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Anvil, LayoutDashboard, ShoppingCart, Package, FolderTree, Truck, Users,
  Receipt, Wallet, BarChart3, Settings, LogOut, Banknote, IdCard, Ruler, Tag, Boxes, Landmark, UserCog, Menu, X, MessageSquare, ScrollText, CalendarClock, Building2, Tags, HandCoins, Coins, Scale, FileSignature, Route, Scissors, ClipboardList, QrCode, FileText, Megaphone, Undo2, CheckCircle2, ChevronDown, Search, Plus, Maximize, Minimize, UserCircle, Camera, Trash2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";
import { capsFor, type BizCapability } from "../lib/businessType";
import ThemeToggle from "./ThemeToggle";
import Calculator from "./Calculator";
import NotificationBell from "./NotificationBell";
import { Modal, useToast } from "./ui";

// Sidebar map — grouped into sections. `roles` hides links the user can't use
// (server still enforces). A section header only renders if it has visible items.
const ALL = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
// `cap` hides a link unless the shop's Business Type enables that capability
// (e.g. steel Weight Calc / Cutting only for building-materials & hardware). The
// route always exists — this only tidies the sidebar per trade.
const NAV_GROUPS: { section?: string; icon?: typeof LayoutDashboard; items: { to: string; label: string; icon: typeof LayoutDashboard; roles: string[]; cap?: BizCapability }[] }[] = [
  {
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ALL },
    ],
  },
  {
    section: "Sell",
    icon: ShoppingCart,
    items: [
      { to: "/pos", label: "POS / New Sale", icon: ShoppingCart, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"] },
      { to: "/sales", label: "Sales", icon: Receipt, roles: ALL },
      { to: "/walk-in-return", label: "Walk-in Return", icon: Undo2, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"] },
      { to: "/bookings", label: "Bookings", icon: CalendarClock, roles: ALL },
      { to: "/estimator", label: "Estimator", icon: Building2, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"], cap: "estimator" },
      { to: "/delivery-trips", label: "Delivery Trips", icon: Route, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"], cap: "delivery" },
    ],
  },
  {
    section: "Inventory",
    icon: Package,
    items: [
      { to: "/products", label: "Products", icon: Package, roles: ALL },
      { to: "/stock", label: "Stock", icon: Boxes, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/weight-calc", label: "Weight Calc", icon: Scale, roles: ALL, cap: "steelTools" },
      { to: "/cutting", label: "Cutting", icon: Scissors, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"], cap: "steelTools" },
      { to: "/purchases", label: "Purchases", icon: Truck, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/labels", label: "Print Labels", icon: QrCode, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { to: "/categories", label: "Categories", icon: FolderTree, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { to: "/brands", label: "Brands", icon: Tag, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { to: "/units", label: "Units", icon: Ruler, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
    ],
  },
  {
    section: "People",
    icon: Users,
    items: [
      { to: "/customers", label: "Customers", icon: Users, roles: ALL },
      { to: "/outreach", label: "Outreach", icon: Megaphone, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { to: "/vendors", label: "Vendors", icon: Truck, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/vendor-notes", label: "Vendor Notes", icon: FileText, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { to: "/price-groups", label: "Price Groups", icon: Tags, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { to: "/rate-contracts", label: "Rate Contracts", icon: FileSignature, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
      { to: "/employees", label: "Employees", icon: IdCard, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
    ],
  },
  {
    section: "Money",
    icon: Wallet,
    items: [
      { to: "/accounts", label: "Accounts & Cash", icon: Landmark, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/bank-reconciliation", label: "Bank Reconciliation", icon: CheckCircle2, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/payments", label: "Payments", icon: Wallet, roles: ALL },
      { to: "/promises", label: "Promises", icon: HandCoins, roles: ALL },
      { to: "/cheques", label: "Cheques", icon: ScrollText, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/day-close", label: "Day Close", icon: Coins, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/expenses", label: "Expenses", icon: Banknote, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
    ],
  },
  {
    section: "Insights",
    icon: BarChart3,
    items: [
      { to: "/reports", label: "Reports", icon: BarChart3, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"] },
      { to: "/messages", label: "Messages", icon: MessageSquare, roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"] },
    ],
  },
  {
    section: "Admin",
    icon: Settings,
    items: [
      { to: "/users", label: "Users & Roles", icon: UserCog, roles: ["SUPER_ADMIN", "ADMIN"] },
      { to: "/settings", label: "Settings", icon: Settings, roles: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [account, setAccount] = useState(false);

  // First run: the owner picks a Business Type before anything else
  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: Record<string, string> }>("/settings"),
    staleTime: 60_000,
  });
  if (
    settingsData &&
    settingsData.settings.onboarding_done !== "1" &&
    user?.role === "SUPER_ADMIN"
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // Business-Type capabilities tailor the sidebar (falls back to all-enabled
  // while settings load, so nothing flicker-hides).
  const caps = capsFor(settingsData?.settings.business_type);

  const shopName = settingsData?.settings.shop_name || "SoftGlaze";
  const shopLogo = settingsData?.settings.shop_logo_thumb || settingsData?.settings.shop_logo;
  const initials = (user?.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const brandMark = (size: "sm" | "md") => (
    shopLogo ? (
      <img src={shopLogo} alt="" className={`${size === "sm" ? "w-8 h-8" : "w-10 h-10"} rounded-[10px] object-cover border border-edge`} />
    ) : (
      <div className={`${size === "sm" ? "w-8 h-8" : "w-10 h-10"} rounded-[10px] tile-grad flex items-center justify-center`}>
        <Anvil size={size === "sm" ? 16 : 20} />
      </div>
    )
  );

  const location = useLocation();
  const isActivePath = (to: string) => (to === "/" ? location.pathname === "/" : location.pathname === to || location.pathname.startsWith(to + "/"));
  const activeSection = useMemo(() => {
    for (const g of NAV_GROUPS) { if (g.section && g.items.some((i) => isActivePath(i.to))) return g.section; }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  // Sell + Inventory stay open by default (still collapsible), plus the active section.
  const [openSections, setOpenSections] = useState<string[]>(
    [...new Set(["Sell", "Inventory", ...(activeSection ? [activeSection] : [])])]
  );
  useEffect(() => { if (activeSection && !openSections.includes(activeSection)) setOpenSections((s) => [...s, activeSection]); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeSection]);
  const nav = useNavigate();
  const [headerSearch, setHeaderSearch] = useState("");
  const toggleSection = (s: string) => setOpenSections((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen flex bg-app">
      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setNavOpen(false)} />
      )}

      {/* Sidebar — fixed drawer on mobile, static on desktop */}
      <aside
        className={`w-64 shrink-0 border-r border-edge glass flex flex-col
          fixed inset-y-0 left-0 z-50 transition-transform duration-200
          ${navOpen ? "translate-x-0" : "-translate-x-full"}
          lg:sticky lg:top-0 lg:h-screen lg:self-start lg:translate-x-0`}
      >
        <div className="flex items-center gap-2.5 px-4 h-16 border-b border-edge">
          {brandMark("md")}
          <div className="flex-1 min-w-0">
            <p className="font-bold display leading-tight truncate">{shopName}</p>
            <p className="text-[11px] text-faint tracking-wide">Stock &amp; POS</p>
          </div>
          <button
            className="lg:hidden text-muted hover:text-ink"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {NAV_GROUPS.map((group, gi) => {
            const items = group.items.filter((n) => (!user || n.roles.includes(user.role)) && (!n.cap || caps.has(n.cap)));
            if (!items.length) return null;

            // Standalone group (Dashboard) — no section header, render items directly.
            if (!group.section) {
              return (
                <div key={gi} className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      onClick={() => setNavOpen(false)}
                      style={({ isActive }) => (isActive ? { background: "var(--accent)", boxShadow: "var(--shadow-color)" } : undefined)}
                      className={({ isActive }) => `group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-all ${isActive ? "text-white font-bold" : "text-muted hover:text-ink hover:bg-surface-2"}`}
                    >
                      {({ isActive }) => (<><item.icon size={17} className={isActive ? "text-white" : "text-faint group-hover:text-ink"} /><span className="truncate">{item.label}</span></>)}
                    </NavLink>
                  ))}
                </div>
              );
            }

            // Collapsible section with sub-menu.
            const open = openSections.includes(group.section);
            const sectionActive = items.some((i) => isActivePath(i.to));
            const SectionIcon = group.icon ?? Boxes;
            return (
              <div key={gi} className="pt-1">
                <button
                  onClick={() => toggleSection(group.section!)}
                  className={`w-full group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-semibold transition-colors ${sectionActive ? "text-accent" : "text-ink hover:bg-surface-2"}`}
                >
                  <SectionIcon size={17} className={sectionActive ? "text-accent" : "text-faint group-hover:text-ink"} />
                  <span className="flex-1 text-left truncate">{group.section}</span>
                  <ChevronDown size={15} className={`text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="mt-0.5 ml-[18px] pl-3 border-l border-edge space-y-0.5 animate-[fadeUp_.15s_ease]">
                    {items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setNavOpen(false)}
                        className={({ isActive }) => `group relative flex items-center gap-2.5 pl-3 pr-2.5 py-1.5 rounded-md text-[13px] transition-colors ${isActive ? "text-accent font-bold bg-[var(--accent-soft)]" : "text-muted hover:text-ink hover:bg-surface-2"}`}
                      >
                        {({ isActive }) => (
                          <>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-accent" : "bg-[var(--border-strong)] group-hover:bg-muted"}`} />
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-edge">
          <button
            className="w-full flex items-center gap-2.5 text-left rounded-lg p-1.5 hover:bg-surface-2 transition-colors"
            onClick={() => setAccount(true)}
            title="My account"
          >
            <Avatar avatar={user?.avatar} initials={initials} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold truncate">{user?.name}</span>
              <span className="block text-[11px] text-faint capitalize">{user?.role?.toLowerCase().replace("_", " ")}</span>
            </span>
            <UserCog size={15} className="text-faint shrink-0" />
          </button>
        </div>
      </aside>

      {account && <MyAccountModal onClose={() => setAccount(false)} />}

      {/* Content + footer */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top header */}
        <header className="sticky top-0 z-30 h-14 shrink-0 glass border-b border-edge flex items-center gap-1.5 sm:gap-2 px-3 lg:px-5">
          <button className="btn btn-ghost !p-2 lg:!hidden" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={18} /></button>
          <span className="lg:hidden font-bold display truncate">{shopName}</span>

          <form
            onSubmit={(e) => { e.preventDefault(); const q = headerSearch.trim(); if (q) nav(`/products?q=${encodeURIComponent(q)}`); }}
            className="relative hidden md:block w-full max-w-sm"
          >
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input className="input !pl-9 !py-2" value={headerSearch} onChange={(e) => setHeaderSearch(e.target.value)} placeholder="Search products…" aria-label="Search products" />
          </form>
          {/* Spacer keeps search on the left and pushes the icon cluster to the right edge */}
          <div className="flex-1" />

          <Link to="/pos" className="btn btn-primary !py-2 !hidden sm:!inline-flex" title="Open POS"><ShoppingCart size={16} /> POS</Link>
          <AddNewMenu />
          <FullscreenButton />
          <NotificationBell />
          <ThemeToggle />
          {["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"].includes(user?.role ?? "") && (
            <Link to="/settings" className="btn btn-ghost !p-2 !hidden sm:!inline-flex" title="Settings"><Settings size={17} /></Link>
          )}
          <ProfileMenu name={user?.name} role={user?.role} initials={initials} avatar={user?.avatar} onAccount={() => setAccount(true)} onLogout={logout} />
        </header>

        <main className="flex-1 p-4 lg:p-7 w-full">
          <Outlet />
        </main>
        <footer className="sticky bottom-0 z-20 border-t border-edge glass mt-2">
          <div className="w-full px-4 lg:px-7 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
            <span>© {year} <span className="font-semibold text-muted">{shopName}</span>. All rights reserved.</span>
            <span>SoftGlaze Stock Manager</span>
          </div>
        </footer>
      </div>

      {/* Global calculator (also available inside POS) */}
      <Calculator />
    </div>
  );
}

/* ───────────────────────── Header menus ───────────────────────── */

const NEW_LINKS: { to: string; label: string; icon: typeof LayoutDashboard }[] = [
  { to: "/pos", label: "New Sale", icon: ShoppingCart },
  { to: "/products", label: "Product", icon: Package },
  { to: "/customers", label: "Customer", icon: Users },
  { to: "/vendors", label: "Vendor", icon: Truck },
  { to: "/purchases", label: "Purchase", icon: ClipboardList },
  { to: "/expenses", label: "Expense", icon: Banknote },
];

/** Profile picture — the uploaded avatar, or the user's initials on a gradient tile. */
function Avatar({ avatar, initials, size = 36, className = "" }: { avatar?: string | null; initials: string; size?: number; className?: string }) {
  if (avatar) return <img src={avatar} alt="" style={{ width: size, height: size }} className={`shrink-0 rounded-lg object-cover border border-edge ${className}`} />;
  return <span style={{ width: size, height: size }} className={`shrink-0 rounded-lg tile-grad grid place-items-center text-[12px] font-bold text-white ${className}`}>{initials}</span>;
}

function HeaderMenu({ trigger, title, panelClass = "w-56", children }: { trigger: ReactNode; title: string; panelClass?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" title={title} aria-label={title} onClick={() => setOpen((o) => !o)} className="inline-flex items-center">{trigger}</button>
      {open && (
        <div className={`absolute top-full mt-2 right-0 ${panelClass} card shadow-2xl z-50 p-1.5 animate-[fadeUp_.14s_ease]`} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function AddNewMenu() {
  return (
    <HeaderMenu title="Add new" panelClass="w-64" trigger={<span className="btn btn-secondary !py-2 !hidden sm:!inline-flex"><Plus size={16} /> New</span>}>
      <p className="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">Create new</p>
      <div className="grid grid-cols-3 gap-1">
        {NEW_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-2.5 text-[11.5px] font-medium text-muted hover:text-ink hover:bg-surface-2 transition-colors">
            <span className="w-9 h-9 rounded-lg bg-surface-2 grid place-items-center text-accent"><l.icon size={17} /></span>
            {l.label}
          </Link>
        ))}
      </div>
    </HeaderMenu>
  );
}

function FullscreenButton() {
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFull(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => { document.removeEventListener("fullscreenchange", onChange); document.removeEventListener("webkitfullscreenchange", onChange); };
  }, []);
  const toggle = async () => {
    try {
      const el = document.documentElement as any;
      const inFull = document.fullscreenElement || (document as any).webkitFullscreenElement;
      if (!inFull) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) await req.call(el);
      } else {
        const exit = document.exitFullscreen || (document as any).webkitExitFullscreen || (document as any).msExitFullscreen;
        if (exit) await exit.call(document);
      }
    } catch { /* browser blocked it (e.g. inside a restricted frame) — nothing else to do */ }
  };
  return <button className="btn btn-ghost !p-2 !hidden md:!inline-flex" onClick={toggle} title={isFull ? "Exit fullscreen" : "Toggle fullscreen"} aria-label="Toggle fullscreen">{isFull ? <Minimize size={17} /> : <Maximize size={17} />}</button>;
}

function ProfileMenu({ name, role, initials, avatar, onAccount, onLogout }: { name?: string; role?: string; initials: string; avatar?: string | null; onAccount: () => void; onLogout: () => void }) {
  return (
    <HeaderMenu title="Account" panelClass="w-52" trigger={<Avatar avatar={avatar} initials={initials} size={36} />}>
      <div className="px-2.5 py-2 border-b border-edge mb-1 flex items-center gap-2.5">
        <Avatar avatar={avatar} initials={initials} size={34} />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{name}</p>
          <p className="text-[11px] text-faint capitalize">{role?.toLowerCase().replace("_", " ")}</p>
        </div>
      </div>
      <button onClick={onAccount} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted hover:text-ink hover:bg-surface-2 transition-colors"><UserCircle size={16} /> My account</button>
      <Link to="/settings" className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted hover:text-ink hover:bg-surface-2 transition-colors"><Settings size={16} /> Settings</Link>
      <button onClick={onLogout} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger hover:bg-surface-2 transition-colors"><LogOut size={16} /> Logout</button>
    </HeaderMenu>
  );
}

/** My account — any user edits their own name/phone/picture and changes their password. */
function MyAccountModal({ onClose }: { onClose: () => void }) {
  const { user, refreshMe } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const initials = (user?.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  async function uploadPhoto(file: File) {
    setPhotoBusy(true);
    try {
      const fd = new FormData(); fd.append("avatar", file);
      await api("/users/me/avatar", { method: "POST", body: fd, isForm: true });
      await refreshMe();
      toast("Profile picture updated");
    } catch (err) { toast((err as ApiError).message, "error"); }
    finally { setPhotoBusy(false); }
  }
  async function removePhoto() {
    setPhotoBusy(true);
    try { await api("/users/me/avatar", { method: "DELETE" }); await refreshMe(); toast("Profile picture removed"); }
    catch (err) { toast((err as ApiError).message, "error"); }
    finally { setPhotoBusy(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name, phone: phone || null };
      if (newPassword) { body.currentPassword = currentPassword; body.newPassword = newPassword; }
      await api("/users/me", { method: "PATCH", body });
      await refreshMe();
      toast(newPassword ? "Saved — use your new password next time you log in" : "Profile updated");
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="My account">
      <form onSubmit={save} className="space-y-3">
        <div className="flex items-center gap-4">
          <Avatar avatar={user?.avatar} initials={initials} size={64} className="!text-xl" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => photoRef.current?.click()} disabled={photoBusy}><Camera size={15} /> {photoBusy ? "Saving…" : user?.avatar ? "Change photo" : "Add photo"}</button>
            {user?.avatar && <button type="button" className="btn btn-secondary hover:!text-danger" onClick={removePhoto} disabled={photoBusy} title="Remove photo"><Trash2 size={15} /></button>}
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadPhoto(e.target.files[0]); e.target.value = ""; }} />
          </div>
        </div>
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div><label className="label">Phone</label><input className="input mono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300 1234567" /></div>
        <div className="text-xs text-muted">{user?.email} · {user?.role}</div>
        <div className="border-t border-edge pt-3 space-y-3">
          <p className="text-sm font-medium">Change password <span className="text-muted font-normal">(optional)</span></p>
          <div><label className="label">Current password</label><input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" /></div>
          <div><label className="label">New password</label><input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" /></div>
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
