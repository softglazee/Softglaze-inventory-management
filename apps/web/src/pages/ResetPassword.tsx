import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Anvil, KeyRound, ArrowLeft, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";

/**
 * Landing page for the emailed link. The token lives in the query string; the server
 * consumes it, sets the new password and signs every other session out.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Passwords do not match");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setBusy(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password } });
      setDone(true);
      setTimeout(() => navigate("/login"), 2200);
    } catch (err) {
      setError((err as ApiError).message ?? "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>

      <div className="w-full max-w-sm animate-[fadeUp_.3s_ease]">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-xl bg-accent text-accent-ink flex items-center justify-center"><Anvil size={24} /></div>
          <div>
            <h1 className="text-xl font-bold leading-tight">SoftGlaze</h1>
            <p className="text-muted text-xs">Stock Management &amp; POS</p>
          </div>
        </div>

        <div className="card p-6">
          {done ? (
            <div className="text-center py-2">
              <CheckCircle2 size={38} className="text-success mx-auto mb-3" />
              <h2 className="text-lg font-semibold mb-1">Password updated</h2>
              <p className="text-muted text-sm">Taking you to the sign-in page…</p>
            </div>
          ) : !token ? (
            <>
              <h2 className="text-lg font-semibold mb-1">This link is incomplete</h2>
              <p className="text-muted text-sm mb-5">
                Open the link exactly as it appears in the email, or request a new one.
              </p>
              <Link to="/forgot-password" className="btn btn-primary w-full">Request a new link</Link>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-1">Choose a new password</h2>
              <p className="text-muted text-sm mb-5">
                At least 8 characters. Signing in again everywhere else will be required.
              </p>
              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="label" htmlFor="pw">New password</label>
                  <input id="pw" type="password" className="input" value={password}
                    onChange={(e) => setPassword(e.target.value)} required autoFocus autoComplete="new-password" />
                </div>
                <div>
                  <label className="label" htmlFor="pw2">Confirm password</label>
                  <input id="pw2" type="password" className="input" value={confirm}
                    onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
                </div>

                {error && <p className="text-danger text-sm">{error}</p>}

                <button className="btn btn-primary w-full !py-2.5" disabled={busy}>
                  <KeyRound size={16} />
                  {busy ? "Saving…" : "Set new password"}
                </button>
              </form>
            </>
          )}
        </div>

        {!done && (
          <p className="text-muted text-xs text-center mt-4">
            <Link to="/login" className="text-accent font-semibold inline-flex items-center gap-1">
              <ArrowLeft size={12} /> Back to sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
