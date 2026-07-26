import { useEffect, useState } from "react";

type Item = { name: string; qty: number; price: number; total: number };
type State = { shop: string; symbol: string; items: Item[]; payable: number; done: { invoiceNo: string; total: number; change: number } | null };

/**
 * G5 — Customer display / 2nd screen. Open this in a second browser window on the same
 * PC (e.g. dragged to a customer-facing monitor). It mirrors the POS cart live via a
 * BroadcastChannel — no server round-trip. Shows the running total, then a thank-you +
 * change when the sale completes.
 */
export default function Display() {
  const [s, setS] = useState<State>({ shop: "SoftGlaze", symbol: "₨", items: [], payable: 0, done: null });
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("pos-display");
    bc.onmessage = (e) => setS((prev) => ({ ...prev, ...e.data }));
    return () => bc.close();
  }, []);
  const money = (n: number) => `${s.symbol} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 bg-app text-ink flex flex-col">
      <div className="px-8 py-5 border-b border-edge flex items-center justify-between">
        <span className="text-3xl font-bold display">{s.shop}</span>
        <span className="text-muted">Welcome</span>
      </div>

      {s.done ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
          <div className="text-4xl font-bold text-success">Thank you!</div>
          <div className="text-muted">Invoice {s.done.invoiceNo}</div>
          <div className="text-6xl font-bold money">{money(s.done.total)}</div>
          {s.done.change > 0 && <div className="text-2xl">Change: <span className="money text-accent font-bold">{money(s.done.change)}</span></div>}
        </div>
      ) : s.items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-2xl text-muted">Ready…</div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-8 py-4">
            <table className="w-full text-2xl">
              <tbody>
                {s.items.map((it, i) => (
                  <tr key={i} className="border-b border-edge/60">
                    <td className="py-3">{it.name}</td>
                    <td className="py-3 text-right text-muted mono whitespace-nowrap px-4">{it.qty} × {money(it.price)}</td>
                    <td className="py-3 text-right money font-semibold whitespace-nowrap">{money(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-8 py-6 border-t-2 border-edge flex items-center justify-between">
            <span className="text-3xl text-muted">Total</span>
            <span className="text-6xl font-bold money text-accent">{money(s.payable)}</span>
          </div>
        </>
      )}
    </div>
  );
}
