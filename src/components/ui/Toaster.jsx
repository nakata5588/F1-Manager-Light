import { X } from "lucide-react";
import { useGame } from "@/state/GameStore";

export function Toaster() {
  const toasts = useGame((s) => s.uiToasts);
  const dismiss = useGame((s) => s.dismissToast);

  if (!toasts?.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto w-80 max-w-[92vw] rounded-xl border bg-white/95 shadow-md backdrop-blur px-4 py-3
                     dark:bg-zinc-900/95 dark:border-zinc-700"
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 h-2 w-2 rounded-full ${
              t.type === "success" ? "bg-green-500" :
              t.type === "warn"    ? "bg-amber-500" :
              t.type === "error"   ? "bg-red-500"   :
                                      "bg-blue-500"
            }`} />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.description && (
                <div className="text-sm text-gray-600 dark:text-gray-300 break-words">
                  {t.description}
                </div>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-auto -mr-1 p-1.5 rounded hover:bg-gray-100 dark:hover:bg-zinc-800"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
