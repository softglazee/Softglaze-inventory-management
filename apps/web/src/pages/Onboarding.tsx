import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Anvil, Store, Check, ArrowRight } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { BusinessPresetInfo } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";
import { useToast } from "../components/ui";

/**
 * First-run onboarding — the owner picks a Business Type; we seed categories,
 * units and a few sample products so the shop isn't empty on day one.
 */
export default function Onboarding() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string>("building_materials");
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["presets"],
    queryFn: () => api<{ presets: BusinessPresetInfo[] }>("/settings/presets"),
  });
  const presets = data?.presets ?? [];

  const apply = useMutation({
    mutationFn: (type: string) =>
      api<{ preset: string; unitsAdded: number; categoriesAdded: number; productsAdded: number }>(
        "/settings/apply-preset",
        { method: "POST", body: { type } }
      ),
    onSuccess: (d) => {
      // Drop cached settings so Layout re-reads onboarding_done fresh (avoids a redirect loop)
      qc.removeQueries({ queryKey: ["settings"] });
      qc.invalidateQueries();
      toast(
        `Shop ready! Added ${d.categoriesAdded} categories, ${d.unitsAdded} units, ${d.productsAdded} sample products.`
      );
      navigate("/");
    },
    onError: (e: ApiError) => setError(e.message),
  });

  // Only the owner runs onboarding
  if (user && user.role !== "SUPER_ADMIN") {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen p-6 flex flex-col items-center">
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent text-accent-ink flex items-center justify-center">
              <Anvil size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Welcome to SoftGlaze</h1>
              <p className="text-muted text-xs">One-time shop setup</p>
            </div>
          </div>
          <ThemeToggle />
        </div>

        <h2 className="text-xl font-bold display mb-1">What kind of shop is this?</h2>
        <p className="text-muted text-sm mb-6">
          We'll prepare your categories and units so you can start right away. You can change or
          delete everything later — this just saves you typing.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          {presets.map((p) => {
            const active = selected === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setSelected(p.key)}
                className={`card p-4 text-left transition-colors ${
                  active ? "!border-accent ring-2 ring-accent/25" : "hover:bg-surface-2"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <Store size={16} className={active ? "text-accent" : "text-muted"} />
                    {p.label}
                  </div>
                  {active && <Check size={16} className="text-accent shrink-0" />}
                </div>
                <p className="text-muted text-xs mt-1.5">{p.description}</p>
                {p.categoryNames.length > 0 && (
                  <p className="text-xs mt-2.5 text-muted">
                    <span className="text-ink font-medium">Includes:</span>{" "}
                    {p.categoryNames.slice(0, 4).join(", ")}
                    {p.categoryNames.length > 4 ? "…" : ""}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {error && <p className="text-danger text-sm mb-3">{error}</p>}

        <div className="flex justify-end">
          <button
            className="btn btn-primary"
            disabled={apply.isPending || !selected}
            onClick={() => apply.mutate(selected)}
          >
            {apply.isPending ? "Setting up your shop…" : "Set up my shop"}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
