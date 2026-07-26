import { useEffect, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { ImagePlus, Star, X, UploadCloud } from "lucide-react";
import { useToast } from "./ui";

export type SavedImage = { id: string; url: string; isPrimary?: boolean };

type Props = {
  /** Already-saved images (rendered with primary star + delete). */
  saved?: SavedImage[];
  onSetPrimary?: (id: string) => void;
  onDeleteSaved?: (id: string) => void;
  /** Pending files, controlled by the parent. */
  files: File[];
  onFilesChange: (files: File[]) => void;
  max?: number;
  multiple?: boolean;
  /** Compress large photos in the browser before upload (A4). */
  compress?: boolean;
  hint?: string;
};

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Global drag-and-drop image uploader (A4). Supports drag-drop, click-to-browse,
 * clipboard paste (Ctrl+V a screenshot), reordering pending thumbnails, a primary
 * star for saved images, and client-side compression before upload.
 */
export default function ImageDropzone({
  saved = [],
  onSetPrimary,
  onDeleteSaved,
  files,
  onFilesChange,
  max = 5,
  multiple = true,
  compress = true,
  hint,
}: Props) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const slotsLeft = () => Math.max(0, max - saved.length - files.length);

  async function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    const room = slotsLeft();
    if (room <= 0) {
      toast(`You can add up to ${max} photos`, "error");
      return;
    }
    const accepted: File[] = [];
    setBusy(true);
    try {
      for (const file of incoming.slice(0, multiple ? room : 1)) {
        if (!file.type.startsWith("image/")) {
          toast(`"${file.name}" is not an image`, "error");
          continue;
        }
        if (file.size > MAX_BYTES) {
          toast(`"${file.name}" is larger than 10 MB`, "error");
          continue;
        }
        if (compress && file.size > 400 * 1024) {
          try {
            const out = await imageCompression(file, { maxWidthOrHeight: 1600, maxSizeMB: 2, useWebWorker: true });
            accepted.push(new File([out], file.name, { type: out.type || file.type }));
          } catch {
            accepted.push(file); // compression failed → upload original
          }
        } else {
          accepted.push(file);
        }
      }
    } finally {
      setBusy(false);
    }
    if (accepted.length) onFilesChange([...files, ...accepted].slice(0, multiple ? max - saved.length : 1));
  }

  // Clipboard paste (Ctrl+V a screenshot) while this dropzone is mounted
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (imgs.length) {
        e.preventDefault();
        void addFiles(imgs);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, saved.length]);

  function removePending(i: number) {
    onFilesChange(files.filter((_, idx) => idx !== i));
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...files];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onFilesChange(next);
  }

  return (
    <div ref={rootRef}>
      <div className="flex flex-wrap gap-2">
        {/* Saved images */}
        {saved.map((img) => (
          <div key={img.id} className="relative group">
            <img
              src={img.url}
              alt=""
              className={`w-16 h-16 rounded-lg object-cover border ${img.isPrimary ? "border-accent" : "border-edge"}`}
            />
            <div className="absolute inset-0 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
              {!img.isPrimary && onSetPrimary && (
                <button type="button" title="Make main photo" className="text-white hover:text-accent" onClick={() => onSetPrimary(img.id)}>
                  <Star size={14} />
                </button>
              )}
              {onDeleteSaved && (
                <button type="button" title="Remove photo" className="text-white hover:text-danger" onClick={() => onDeleteSaved(img.id)}>
                  <X size={14} />
                </button>
              )}
            </div>
            {img.isPrimary && <Star size={12} className="absolute -top-1 -right-1 text-accent fill-current" />}
          </div>
        ))}

        {/* Pending files (draggable to reorder) */}
        {files.map((file, i) => (
          <div
            key={i}
            className="relative"
            draggable
            onDragStart={() => (dragIndex.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null) reorder(dragIndex.current, i);
              dragIndex.current = null;
            }}
            title="Drag to reorder"
          >
            <img
              src={URL.createObjectURL(file)}
              alt=""
              className="w-16 h-16 rounded-lg object-cover border border-dashed border-accent/60 cursor-move"
            />
            <button
              type="button"
              className="absolute -top-1.5 -right-1.5 bg-surface border border-edge rounded-full p-0.5 text-muted hover:text-danger"
              onClick={() => removePending(i)}
              aria-label="Remove pending image"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {/* Add tile / dropzone */}
        {slotsLeft() > 0 && (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void addFiles(Array.from(e.dataTransfer.files));
            }}
            className={`w-16 h-16 rounded-lg border border-dashed cursor-pointer flex flex-col items-center justify-center transition-colors ${
              dragOver ? "border-accent text-accent bg-accent/10" : "border-edge text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {busy ? <UploadCloud size={18} className="animate-pulse" /> : <ImagePlus size={18} />}
            <span className="text-[10px] mt-0.5">{busy ? "…" : "Add"}</span>
            <input
              type="file"
              accept="image/*"
              multiple={multiple}
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      <p className="text-xs text-muted mt-1.5">
        {hint ?? `Drag, click, or paste (Ctrl+V) up to ${max} photos — first is the main photo. Large images are shrunk automatically.`}
      </p>
    </div>
  );
}
