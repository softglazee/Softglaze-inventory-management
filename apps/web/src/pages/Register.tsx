import { useState } from "react";
import { Link } from "react-router-dom";
import { Anvil, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError("Passwords do not match");
    if (form.password.length < 8) return setError("Password must be at least 8 characters");
    setBusy(true);
    try {
      await register(form.name, form.email, form.password, form.phone || undefined);
    } catch (err) {
      setError((err as ApiError).message ?? "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-lg bg-accent text-accent-ink flex items-center justify-center">
            <Anvil size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">SoftGlaze</h1>
            <p className="text-muted text-xs">Stock Management &amp; POS</p>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-1">Create owner account</h2>
          <p className="text-muted text-sm mb-5">
            The first account becomes the shop <span className="font-semibold text-ink">Owner (Super Admin)</span>. Staff accounts
            are created later from Users.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">Full name</label>
              <input className="input" placeholder="Muhammad Ali" value={form.name}
                onChange={(e) => set("name", e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" placeholder="owner@shop.com" value={form.email}
                onChange={(e) => set("email", e.target.value)} required />
            </div>
            <div>
              <label className="label">Phone (optional)</label>
              <input className="input" placeholder="03xx-xxxxxxx" value={form.phone}
                onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Password</label>
                <input type="password" className="input" value={form.password}
                  onChange={(e) => set("password", e.target.value)} required />
              </div>
              <div>
                <label className="label">Confirm</label>
                <input type="password" className="input" value={form.confirm}
                  onChange={(e) => set("confirm", e.target.value)} required />
              </div>
            </div>

            {error && <p className="text-danger text-sm">{error}</p>}

            <button className="btn btn-primary w-full" disabled={busy}>
              <UserPlus size={16} />
              {busy ? "Creating…" : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-muted text-xs text-center mt-4">
          Already set up? <Link to="/login" className="text-accent">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
