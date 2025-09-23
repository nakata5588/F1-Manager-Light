import { X } from "lucide-react";

/** Espera message:
 * { id, title, dateISO|date, subtitle?, body?, meta?: { effects?: [{entity,id,name,attr,label,before,delta,after}] } }
 * - Se não houver meta.effects, mostra só o body.
 */
export default function MessageModal({ message, onClose }) {
  if (!message) return null;
  const effects = message?.meta?.effects || [];
  const dateLabel = message?.dateISO || message?.date || "";

  return (
    <div className="fixed inset-0 z-[10000] bg-black/40 flex items-center justify-center p-3">
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-zinc-900 border dark:border-zinc-700 shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b dark:border-zinc-700">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-500">{dateLabel}</div>
            <h2 className="text-xl font-semibold leading-tight">{message?.title || "Message"}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {message?.subtitle && (
            <div className="text-sm text-gray-700 dark:text-gray-300">{message.subtitle}</div>
          )}

          {!!effects.length && (
            <div className="rounded-xl border dark:border-zinc-700 p-3">
              <div className="font-semibold mb-2">Outcome</div>
              <ul className="space-y-1">
                {effects.map((e, idx) => {
                  const pos = (e.delta ?? 0) > 0;
                  const neg = (e.delta ?? 0) < 0;
                  return (
                    <li key={idx} className="text-sm">
                      <span
                        data-entity={e.entity || "driver"}
                        data-id={e.id}
                        className="entity-link-driver font-medium cursor-pointer"
                        title="Open profile"
                      >
                        {e.name || e.id}
                      </span>
                      {": "}
                      <span className="text-gray-700 dark:text-gray-300">{e.label || e.attr}</span>{" "}
                      {isFinite(e.before) && isFinite(e.after) ? (
                        <>
                          <span className="font-medium">{e.before}</span>{" → "}
                          <span className={`font-semibold ${pos ? "text-green-600" : neg ? "text-red-600" : ""}`}>
                            {e.after}
                          </span>
                          {isFinite(e.delta) && e.delta !== 0 && (
                            <span className={`ml-1 ${pos ? "text-green-600" : "text-red-600"}`}>
                              ({e.delta > 0 ? "+" : ""}{e.delta})
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {isFinite(e.delta) && (
                            <span className={`${pos ? "text-green-600" : neg ? "text-red-600" : ""} font-semibold`}>
                              {e.delta > 0 ? "+" : ""}{e.delta}
                            </span>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {message?.body && (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200">
              {message.body}
            </div>
          )}

          {message?.__debugJSON && (
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer">Meta</summary>
              <pre className="text-xs p-2 rounded bg-gray-50 dark:bg-zinc-800 overflow-auto">
                {message.__debugJSON}
              </pre>
            </details>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-3 border-t dark:border-zinc-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border hover:bg-gray-50 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
