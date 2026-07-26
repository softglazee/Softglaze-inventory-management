import { useEffect, useRef, useState, useCallback } from "react";
import { Calculator as CalcIcon, X, CornerDownLeft } from "lucide-react";

/**
 * Global calculator widget (docs/09 §6). Toggle with the floating button or F12
 * (Ctrl+K also works). Type digits/operators on the keyboard while it's open.
 * "→ field" drops the result into whatever number box you last clicked — handy in
 * POS for quantities, prices and discounts. Draggable by its header.
 */

/** Evaluate a simple + − × ÷ expression (×÷ before +−, left→right). No eval(). */
function evaluate(raw: string): number | null {
  const expr = raw.replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  if (!expr) return null;
  const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
  if (!tokens || tokens.join("") !== expr) return null;
  // number-operator-number… shape only
  const nums: number[] = [];
  const ops: string[] = [];
  let expectNum = true;
  for (const t of tokens) {
    if (expectNum) {
      if (!/^[\d.]/.test(t)) {
        if (t === "-") { nums.push(0); ops.push("-"); continue; } // unary minus
        return null;
      }
      nums.push(Number(t));
      expectNum = false;
    } else {
      if (/[+\-*/]/.test(t) && t.length === 1) { ops.push(t); expectNum = true; }
      else return null;
    }
  }
  if (expectNum) return null;
  // first pass * /
  for (let i = 0; i < ops.length; ) {
    if (ops[i] === "*" || ops[i] === "/") {
      const r = ops[i] === "*" ? nums[i] * nums[i + 1] : nums[i] / nums[i + 1];
      if (!Number.isFinite(r)) return null;
      nums.splice(i, 2, r);
      ops.splice(i, 1);
    } else i++;
  }
  let acc = nums[0];
  for (let i = 0; i < ops.length; i++) acc = ops[i] === "+" ? acc + nums[i + 1] : acc - nums[i + 1];
  return Number.isFinite(acc) ? Math.round(acc * 1e6) / 1e6 : null;
}

export default function Calculator() {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string>("0");
  const [memory, setMemory] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const lastField = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // Remember the last focused number/text input (not one inside the calculator)
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement && (el.type === "number" || el.type === "text") && !el.closest("[data-calc]")) {
        lastField.current = el;
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  const compute = useCallback(() => {
    const r = evaluate(expr);
    if (r !== null) {
      setResult(String(r));
      setExpr(String(r));
    }
  }, [expr]);

  const press = useCallback(
    (k: string) => {
      if (k === "C") { setExpr(""); setResult("0"); return; }
      if (k === "=") { compute(); return; }
      if (k === "⌫") { setExpr((e) => e.slice(0, -1)); return; }
      if (k === "%") { const r = evaluate(expr); if (r !== null) { const v = String(r / 100); setExpr(v); setResult(v); } return; }
      setExpr((e) => e + k);
    },
    [compute, expr]
  );

  // Live preview of the running result
  useEffect(() => {
    const r = evaluate(expr);
    if (r !== null) setResult(String(r));
    else if (expr === "") setResult("0");
  }, [expr]);

  // Global hotkeys + in-panel keyboard entry
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F12" || (e.ctrlKey && (e.key === "k" || e.key === "K"))) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") { setOpen(false); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (inField && !(e.target as HTMLElement).closest("[data-calc]")) return; // don't hijack real inputs
      if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
      else if (e.key === ".") { press("."); e.preventDefault(); }
      else if (["+", "-", "*", "/"].includes(e.key)) { press(e.key); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === "=") { press("="); e.preventDefault(); }
      else if (e.key === "Backspace") { press("⌫"); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, press]);

  function pushToField() {
    const el = lastField.current;
    const r = evaluate(expr);
    const value = r !== null ? String(r) : result;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  }

  // Dragging
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    };
    const up = () => (drag.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "-", "0", ".", "=", "+"];

  return (
    <>
      <button
        className="fixed bottom-5 right-5 z-[80] w-12 h-12 rounded-full bg-accent text-accent-ink shadow-lg flex items-center justify-center hover:brightness-110 transition"
        onClick={() => setOpen((o) => !o)}
        title="Calculator (F12)"
        aria-label="Open calculator"
      >
        <CalcIcon size={20} />
      </button>

      {open && (
        <div
          data-calc
          className="card fixed z-[90] w-64 shadow-2xl select-none"
          style={pos ? { left: pos.x, top: pos.y } : { right: "1.25rem", bottom: "4.75rem" }}
        >
          <div
            className="flex items-center justify-between px-3 h-9 border-b border-edge cursor-move"
            onMouseDown={(e) => { const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }; setPos({ x: r.left, y: r.top }); }}
          >
            <span className="text-xs font-semibold display flex items-center gap-1.5"><CalcIcon size={13} /> Calculator</span>
            <button className="text-muted hover:text-ink" onClick={() => setOpen(false)} aria-label="Close calculator"><X size={15} /></button>
          </div>
          <div className="p-3 space-y-2">
            <div className="rounded-lg bg-surface-2 border border-edge px-3 py-2 text-right">
              <div className="text-[11px] text-muted mono h-4 truncate">{expr || " "}</div>
              <div className="text-xl font-bold mono truncate">{result}</div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <button className="btn btn-secondary !py-1.5 text-xs" onClick={() => press("C")}>C</button>
              <button className="btn btn-secondary !py-1.5 text-xs" onClick={() => press("⌫")}>⌫</button>
              <button className="btn btn-secondary !py-1.5 text-xs" onClick={() => press("%")}>%</button>
              <button className="btn btn-secondary !py-1.5 text-xs" onClick={() => setMemory(0)} title="Clear memory">MC</button>
              {keys.map((k) => (
                <button
                  key={k}
                  className={`btn !py-2 mono ${k === "=" ? "btn-secondary !border-accent !text-accent" : "btn-secondary"}`}
                  onClick={() => press(k)}
                >
                  {k}
                </button>
              ))}
              <button className="btn btn-secondary !py-1.5 text-xs" onClick={() => setMemory((m) => m + (evaluate(expr) ?? 0))} title="Add to memory">M+</button>
              <button className="btn btn-secondary !py-1.5 text-xs" onClick={() => setMemory((m) => m - (evaluate(expr) ?? 0))} title="Subtract from memory">M−</button>
              <button className="btn btn-secondary !py-1.5 text-xs" onClick={() => { setExpr(String(memory)); }} title={`Recall ${memory}`}>MR</button>
              <button className="btn btn-secondary !py-1.5 text-xs !border-accent !text-accent" onClick={pushToField} title="Send result to the box you last clicked"><CornerDownLeft size={13} /></button>
            </div>
            {memory !== 0 && <div className="text-[11px] text-muted text-right">Memory: <span className="mono">{memory}</span></div>}
          </div>
        </div>
      )}
    </>
  );
}
