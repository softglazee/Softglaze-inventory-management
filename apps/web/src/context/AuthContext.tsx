import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, setTokens, getRefreshToken } from "../lib/api";

export type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "CASHIER" | "ACCOUNTANT";
export type User = { id: string; name: string; email: string; role: Role; phone?: string | null; totpEnabled?: boolean; avatar?: string | null };

type AuthState = {
  user: User | null;
  permissions: string[];
  can: (...keys: string[]) => boolean;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  register: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState>(null as never);

type AuthPayload = { user: User; permissions?: string[]; accessToken: string; refreshToken: string };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // SUPER_ADMIN implicitly has everything; otherwise check the fetched set
  function can(...keys: string[]) {
    if (!user) return false;
    if (user.role === "SUPER_ADMIN") return true;
    return keys.some((k) => permissions.includes(k));
  }

  // Restore session on refresh
  useEffect(() => {
    (async () => {
      if (!getRefreshToken()) return setLoading(false);
      try {
        const data = await api<{ user: User; permissions?: string[] }>("/auth/me");
        setUser(data.user);
        setPermissions(data.permissions ?? []);
      } catch {
        setTokens(null, null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string, totpCode?: string) {
    const data = await api<AuthPayload>("/auth/login", { method: "POST", body: { email, password, ...(totpCode ? { totpCode } : {}) } });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    setPermissions(data.permissions ?? []);
    navigate("/");
  }

  async function register(name: string, email: string, password: string, phone?: string) {
    const data = await api<AuthPayload>("/auth/register", { method: "POST", body: { name, email, password, phone } });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
    setPermissions(data.permissions ?? []);
    navigate("/");
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* already invalid — fine */
    }
    setTokens(null, null);
    setUser(null);
    setPermissions([]);
    navigate("/login");
  }

  // Re-pull the signed-in user (after editing own profile / avatar) so the UI updates immediately.
  async function refreshMe() {
    try {
      const data = await api<{ user: User; permissions?: string[] }>("/auth/me");
      setUser(data.user);
      if (data.permissions) setPermissions(data.permissions);
    } catch {
      /* ignore — a failed refresh just leaves the old user in place */
    }
  }

  return (
    <AuthContext.Provider value={{ user, permissions, can, loading, login, register, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
