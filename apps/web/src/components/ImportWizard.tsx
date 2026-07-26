import { useEffect, useMemo, useState } from "react";
import { UploadCloud, FileSpreadsheet, ClipboardPaste, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle, Save } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Modal, useToast } from "./ui";

type Entity = "products" | "customers" | "vendors";
type Field = { key: string; label: string; required: boolean };
type ParseResult = { columns: string[]; rowCount: number; preview: Record<string, string>[]; suggestedMapping: Record<string, string> };
type Report = { total: number; create: number; update: number; skip: number; errorRows: number; errors: { row: number; messages: string[] }[] };
type CommitResult = { created: number; updated: number; skipped: number; failed: number; errors: { row: number; messages: string[] }[] };

type Options = { mode: "skip" | "update"; autoCreateCategories: boolean; autoCreateUnits: boolean; autoCreateBrands: boolean };

const TITLES: Record<Entity, string> = { products: "Import products", customers: "Import customers", vendors: "Import vendors" };

export default function ImportWizard({ entity, open, onClose, onDone }: { entity: Entity; open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [fields, setFields] = useState<Field[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Options>({ mode: "skip", autoCreateCategories: true, autoCreateUnits: true, autoCreateBrands: true });
  const [report, setReport] = useState<Report | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<Record<string, Record<string, string>>>({});

  const tplKey = `sg-import-tpl:${entity}`;

  useEffect(() => {
    if (!open) return;
    // reset each time it opens
    setStep(1);
    setFile(null);
    setText("");
    setParsed(null);
    setMapping({});
    setReport(null);
    setResult(null);
    api<{ fields: Field[] }>(`/import/fields/${entity}`).then((d) => setFields(d.fields)).catch(() => {});
    try {
      setTemplates(JSON.parse(localStorage.getItem(tplKey) ?? "{}"));
    } catch {
      setTemplates({});
    }
  }, [open, entity, tplKey]);

  function buildForm(extra: Record<string, string> = {}) {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (text.trim()) fd.append("text", text);
    fd.append("entity", entity);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
  }

  async function doParse() {
    if (!file && !text.trim()) {
      toast("Choose a file or paste some data first", "error");
      return;
    }
    setBusy(true);
    try {
      const d = await api<ParseResult>("/import/parse", { method: "POST", body: buildForm(), isForm: true });
      setParsed(d);
      setMapping(d.suggestedMapping ?? {});
      setStep(2);
    } catch (e) {
      toast((e as ApiError).message ?? "Could not read that file", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doValidate() {
    const missing = fields.filter((f) => f.required && !mapping[f.key]);
    if (missing.length) {
      toast(`Map the required field: ${missing.map((m) => m.label).join(", ")}`, "error");
      return;
    }
    setBusy(true);
    try {
      const d = await api<Report>(`/import/${entity}/validate`, {
        method: "POST",
        body: buildForm({ mapping: JSON.stringify(mapping), options: JSON.stringify(options) }),
        isForm: true,
      });
      setReport(d);
      setStep(3);
    } catch (e) {
      toast((e as ApiError).message ?? "Validation failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    setBusy(true);
    try {
      const d = await api<CommitResult>(`/import/${entity}/commit`, {
        method: "POST",
        body: buildForm({ mapping: JSON.stringify(mapping), options: JSON.stringify(options) }),
        isForm: true,
      });
      setResult(d);
      setStep(4);
      onDone();
    } catch (e) {
      toast((e as ApiError).message ?? "Import failed", "error");
    } finally {
      setBusy(false);
    }
  }

  function saveTemplate() {
    const name = window.prompt("Name this column mapping (e.g. 'Old software export')");
    if (!name) return;
    const next = { ...templates, [name]: mapping };
    setTemplates(next);
    localStorage.setItem(tplKey, JSON.stringify(next));
    toast(`Mapping "${name}" saved`);
  }

  const columns = parsed?.columns ?? [];

  return (
    <Modal open={open} onClose={onClose} title={TITLES[entity]} wide>
      {/* Stepper */}
      <div className="flex items-center gap-1.5 mb-5 text-xs">
        {["Source", "Map columns", "Check", "Done"].map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center font-semibold ${step >= i + 1 ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted border border-edge"}`}>
              {i + 1}
            </span>
            <span className={step >= i + 1 ? "text-ink" : "text-muted"}>{label}</span>
            {i < 3 && <span className="text-muted mx-1">›</span>}
          </div>
        ))}
      </div>

      {/* Step 1 — Source */}
      {step === 1 && (
        <div className="space-y-4">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) {
                setFile(f);
                setText("");
              }
            }}
            className="block border border-dashed border-edge hover:border-accent rounded-xl p-6 text-center cursor-pointer transition-colors"
          >
            <UploadCloud size={26} className="mx-auto text-muted mb-2" />
            <p className="text-sm">
              {file ? <span className="text-ink font-medium">{file.name}</span> : "Drag a file here, or click to browse"}
            </p>
            <p className="text-xs text-muted mt-1">CSV, Excel (.xlsx/.xls), XML or TXT</p>
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) setText("");
              }}
            />
          </label>

          <div className="text-center text-xs text-muted">— or paste rows from Excel / a sheet —</div>
          <div>
            <div className="flex items-center gap-2 mb-1 text-muted text-xs">
              <ClipboardPaste size={13} /> Paste tab/comma separated data (first row = headings)
            </div>
            <textarea
              className="input font-mono text-xs"
              rows={5}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value.trim()) setFile(null);
              }}
              placeholder={"name\tcategory\tunit\tsalePrice\nLucky Cement 50kg\tCement\tbag\t1350"}
            />
          </div>

          <div className="flex justify-end">
            <button className="btn btn-secondary !border-accent !text-accent" onClick={doParse} disabled={busy}>
              {busy ? "Reading…" : "Next"} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Map columns */}
      {step === 2 && parsed && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-muted">
              Found <span className="text-ink font-semibold">{parsed.rowCount}</span> rows. Match your columns to SoftGlaze fields.
            </p>
            <div className="flex items-center gap-2">
              {Object.keys(templates).length > 0 && (
                <select
                  className="input !w-44 !py-1.5 text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (templates[e.target.value]) setMapping(templates[e.target.value]);
                  }}
                  aria-label="Load saved mapping"
                >
                  <option value="">Load mapping…</option>
                  {Object.keys(templates).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              )}
              <button className="btn btn-secondary !py-1.5 text-sm" onClick={saveTemplate} title="Save this mapping for next time">
                <Save size={14} /> Save mapping
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 max-h-64 overflow-y-auto pr-1">
            {fields.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <label className="text-sm w-36 shrink-0">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </label>
                <select
                  className="input !py-1.5 text-sm"
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                >
                  <option value="">— skip —</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Options */}
          <div className="rounded-lg border border-edge p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted">If a row already exists:</span>
              <select className="input !w-40 !py-1 text-sm" value={options.mode} onChange={(e) => setOptions({ ...options, mode: e.target.value as Options["mode"] })}>
                <option value="skip">Skip it</option>
                <option value="update">Update it</option>
              </select>
            </div>
            {entity === "products" && (
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={options.autoCreateCategories} onChange={(e) => setOptions({ ...options, autoCreateCategories: e.target.checked })} />
                  Create missing categories
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={options.autoCreateUnits} onChange={(e) => setOptions({ ...options, autoCreateUnits: e.target.checked })} />
                  Create missing units
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={options.autoCreateBrands} onChange={(e) => setOptions({ ...options, autoCreateBrands: e.target.checked })} />
                  Create missing brands
                </label>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button className="btn btn-secondary" onClick={() => setStep(1)}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn btn-secondary !border-accent !text-accent" onClick={doValidate} disabled={busy}>
              {busy ? "Checking…" : "Check data"} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Validate report */}
      {step === 3 && report && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Stat label="New" value={report.create} tone="success" />
            <Stat label="Updates" value={report.update} tone="ink" />
            <Stat label="Skipped" value={report.skip} tone="muted" />
            <Stat label="Errors" value={report.errorRows} tone={report.errorRows ? "danger" : "muted"} />
          </div>

          {report.errors.length > 0 && (
            <div className="rounded-lg border border-danger/40 bg-danger/5 max-h-52 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-edge">
                    <th className="text-left px-3 py-1.5 w-16">Row</th>
                    <th className="text-left px-3 py-1.5">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {report.errors.map((e) => (
                    <tr key={e.row} className="border-b border-edge/60 last:border-0">
                      <td className="px-3 py-1.5 mono">{e.row}</td>
                      <td className="px-3 py-1.5 text-danger">{e.messages.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted flex items-center gap-1.5">
            <AlertTriangle size={13} /> Error rows are skipped. Fix them in your file and re-import, or continue to import the good rows.
          </p>

          <div className="flex justify-between">
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn btn-primary" onClick={doCommit} disabled={busy || report.create + report.update === 0}>
              {busy ? "Importing…" : `Import ${report.create + report.update} rows`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Done */}
      {step === 4 && result && (
        <div className="space-y-4 text-center py-4">
          <CheckCircle2 size={40} className="mx-auto text-success" />
          <p className="font-semibold">Import complete</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Created" value={result.created} tone="success" />
            <Stat label="Updated" value={result.updated} tone="ink" />
            <Stat label="Skipped" value={result.skipped} tone="muted" />
            <Stat label="Failed" value={result.failed} tone={result.failed ? "danger" : "muted"} />
          </div>
          <button className="btn btn-secondary mx-auto" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "muted" | "ink" }) {
  const color = { success: "text-success", danger: "text-danger", muted: "text-muted", ink: "text-ink" }[tone];
  return (
    <div className="rounded-lg border border-edge p-2.5">
      <p className={`text-xl font-bold mono ${color}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
