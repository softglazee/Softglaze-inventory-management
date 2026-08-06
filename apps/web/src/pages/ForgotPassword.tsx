import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Anvil, Mail, ArrowLeft, ShieldAlert } from "lucide-react";
import { api, ApiError } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";

type ForgotResult = { delivered: boolean; reason?: string; message: string };

/**
 * Ask for a reset link. Deliberately never says whether the address has an account —
 * that would turn this page into a way to find out who works at the shop.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ForgotResult | null>(null);
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [shop, setShop] = useState<{ name: string; logo?: string }>({ name: "SoftGlaze" });

  useEffect(() => {
    api<{ available: boolean }>("/auth/password-reset-available")
      .then((d) => setEmailAvailable(d.available))
      .catch(() => setEmailAvailable(null));
    api<{ settings: Record<string, string> }>("/settings/public")
      .then((d) => setShop({ name: d.settings.shop_name || "SoftGlaze", logo: d.settings.shop_logo_thumb || d.settings.shop_logo }))
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setDone(await api<ForgotResult>("/auth/forgot-password", { method: "POST", body: { email } }));
    } catch (err) {
      setError((err as ApiError).message ?? "Could not send the reset link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>

      <div className="w-full max-w-sm animate-[fadeUp_.3s_ease]">
        <div className="flex items-center gap-3 mb-8 justify-center">
          {shop.logo ? (
            <img src={shop.logo} alt="" className="w-11 h-11 rounded-xl object-cover border border-edge" />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-accent text-accent-ink flex items-center justify-center"><Anvil size={24} /></div>
          )}
          <div>
            <h1 className="text-xl font-bold leading-tight">{shop.name}</h1>
            <p className="text-muted text-xs">Stock Management &amp; POS</p>
          </div>
        </div>

        <div className="card p-6">
          {done ? (
            <>
              <h2 className="text-lg font-semibold mb-1">
                {done.delivered ? "Check your email" : "Ask your administrator"}
              </h2>
              <p className="text-muted text-sm mb-5">{done.message}</p>
              {done.delivered && (
                <p className="text-muted text-xs mb-5">
                  Nothing arrived? Check the spam folder, or ask an administrator to reset it for you
                  from <span className="text-ink font-medium">Users &amp; Roles</span>.
                </p>
              )}
              <Link to="/login" className="btn btn-secondary w-full"><ArrowLeft size={15} /> Back to sign in</Link>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-1">Forgot your password?</h2>
              <p className="text-muted text-sm mb-5">
                Enter the email on your account and we'll send a link to choose a new password.
              </p>

              {emailAvailable === false && (
                <div className="mb-4 flex gap-2.5 text-sm rounded-xl border border-edge bg-surface-2 p-3">
                  <ShieldAlert size={17} className="text-warn shrink-0 mt-0.5" />
                  <span>
                    Email isn't set up on this system, so a reset link can't be sent. An administrator can
                    reset your password from <span className="font-medium text-ink">Users &amp; Roles</span>.
                  </span>
                </div>
              )}

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" type="email" className="input" placeholder="owner@shop.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                </div>

                {error && <p className="text-danger text-sm">{error}</p>}

                <button className="btn btn-primary w-full !py-2.5" disabled={busy}>
                  <Mail size={16} />
                  {busy ? "Sending…" : "Send reset link"}
                </button>
              </form>
            </>
          )}
        </div>

        {!done && (
          <p className="text-muted text-xs text-center mt-4">
            Remembered it? <Link to="/login" className="text-accent font-semibold">Sign in</Link>
          </p>
        )}
      </div>
    </div>
  );
}
