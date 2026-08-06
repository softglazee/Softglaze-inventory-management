import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Anvil, LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError, getRemember, setRemember } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [totpNeeded, setTotpNeeded] = useState(false); // H3 — 2FA challenge
  const [totpCode, setTotpCode] = useState("");
  const [remember, setRememberState] = useState(getRemember());
  const [shop, setShop] = useState<{ name: string; logo?: string }>({ name: "SoftGlaze" });

  // If no user exists yet (fresh install), send owner to Register
  useEffect(() => {
    api<{ needsSetup: boolean }>("/auth/setup-status")
      .then((d) => setNeedsSetup(d.needsSetup))
      .catch(() => {});
    api<{ settings: Record<string, string> }>("/settings/public")
      .then((d) =>
        setShop({ name: d.settings.shop_name || "SoftGlaze", logo: d.settings.shop_logo_thumb || d.settings.shop_logo })
      )
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Decide the storage BEFORE the tokens arrive, so they land in the right place.
      setRemember(remember);
      await login(email, password, totpNeeded ? totpCode : undefined);
    } catch (err) {
      const e = err as ApiError;
      if (e.code === "TOTP_REQUIRED") { setTotpNeeded(true); setError(null); }
      else if (e.code === "TOTP_INVALID") { setTotpNeeded(true); setError(e.message); }
      else setError(e.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Brand panel (desktop) */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-surface border-r border-edge relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.5] pointer-events-none"
          style={{ background: "radial-gradient(120% 90% at 15% 0%, var(--accent-soft), transparent 55%)" }}
        />
        <div className="relative flex items-center gap-3">
          {shop.logo ? (
            <img src={shop.logo} alt="" className="w-10 h-10 rounded-xl object-cover border border-edge" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-accent text-accent-ink flex items-center justify-center shadow-sm">
              <Anvil size={22} />
            </div>
          )}
          <div>
            <p className="font-bold display leading-tight">{shop.name}</p>
            <p className="text-faint text-xs">Stock &amp; POS</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-extrabold display tracking-tight leading-tight">Run the whole shop from one clean screen.</h2>
          <p className="text-muted mt-3">Sales, udhaar, stock, purchases, and reports — accurate to the last rupee, dark or light.</p>
          <div className="flex gap-2 mt-6">
            {["Sales & POS", "Udhaar khata", "Live reports"].map((t) => (
              <span key={t} className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--accent-soft)] text-accent">{t}</span>
            ))}
          </div>
        </div>
        <p className="relative text-faint text-xs">© {shop.name} · SoftGlaze Stock Manager</p>
      </div>

      {/* Form panel */}
      <div className="min-h-screen flex items-center justify-center p-4 relative">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm animate-[fadeUp_.3s_ease]">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            {shop.logo ? (
              <img src={shop.logo} alt="" className="w-11 h-11 rounded-xl object-cover border border-edge" />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-accent text-accent-ink flex items-center justify-center">
                <Anvil size={24} />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold leading-tight">{shop.name}</h1>
              <p className="text-muted text-xs">Stock Management &amp; POS</p>
            </div>
          </div>

          <h2 className="text-2xl font-extrabold display tracking-tight mb-1">Welcome back</h2>
          <p className="text-muted text-sm mb-6">Enter your details to open the shop.</p>

          {needsSetup && (
            <div className="mb-4 text-sm rounded-xl border border-edge bg-surface-2 p-3">
              Fresh installation detected —{" "}
              <button onClick={() => navigate("/register")} className="text-accent font-semibold underline">
                create the owner (admin) account
              </button>{" "}
              first.
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" placeholder="owner@shop.com"
                value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>

            {totpNeeded && (
              <div>
                <label className="label" htmlFor="totp">Authenticator code</label>
                <input id="totp" inputMode="numeric" autoComplete="one-time-code" className="input mono tracking-widest text-center" placeholder="123456"
                  value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required autoFocus />
                <p className="text-muted text-xs mt-1">Enter the 6-digit code from your authenticator app.</p>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                  checked={remember}
                  onChange={(e) => setRememberState(e.target.checked)}
                />
                Keep me signed in
              </label>
              <Link to="/forgot-password" className="text-sm text-accent font-semibold hover:underline">
                Forgot password?
              </Link>
            </div>

            {error && <p className="text-danger text-sm">{error}</p>}

            <button className="btn btn-primary w-full !py-2.5" disabled={busy}>
              <LogIn size={16} />
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-muted text-xs text-center mt-6">
            First time here? <Link to="/register" className="text-accent font-semibold">Create owner account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
