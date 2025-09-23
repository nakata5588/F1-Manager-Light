import { useState, useRef, useEffect } from "react";
import { MoreVertical } from "lucide-react";

export default function ActionsButton({ label = "Actions", children, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, []);

  return (
    <div ref={ref} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-zinc-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={16} />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 origin-top-right rounded-xl border bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {children}
        </div>
      )}
    </div>
  );
}
