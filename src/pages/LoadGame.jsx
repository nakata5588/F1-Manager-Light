// src/pages/LoadGame.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { useNavigate } from "react-router-dom";

/* ---------------- routing target após carregar um save ---------------- */
const AFTER_LOAD_ROUTE = "/Home"; // 🧭 ajusta para a tua página do Hub ("/hub", "/game", etc.)

/* ---------------- utils ---------------- */
const SAVE_PREFIXES = ["f1ml_save_", "save_", "f1manager_", "import_"];

const tryFetchJSON = async (paths) => {
  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
};

const normId = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]+/g, "");

const fmtDateTime = (d) =>
  d
    ? d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const fmtDateOnly = (d) =>
  d
    ? d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

const bytesToStr = (b) => {
  const n = Number(b || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const ordinalShort = (n) => {
  if (n == null || !Number.isFinite(+n)) return "—";
  const num = +n;
  const s = ["th", "st", "nd", "rd"], v = num % 100;
  return num + (s[(v - 20) % 10] || s[v] || s[0]);
};

/* Date parsing robusto */
const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value); // timestamp ms
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)); // evita drift TZ
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
};

const pickFirst = (...vals) =>
  vals.find((v) => v !== undefined && v !== null && v !== "");

const extractCurrentDayValue = (gs, raw) =>
  pickFirst(
    // alguns exports podem gravar na meta
    raw?.meta?.currentDateISO,
    raw?.meta?.current_day,
    // chaves comuns no gameState
    gs?.currentDateISO,
    gs?.currentDate,
    gs?.dateISO,
    gs?.date,
    gs?.gameDate,
    gs?.dayISO,
    // por vezes aninhado num objeto time
    gs?.time?.currentDateISO,
    gs?.time?.dateISO,
    gs?.time?.currentDate
  );

function isLikelySave(obj) {
  if (!obj || typeof obj !== "object") return false;
  if ("team" in obj || "calendar" in obj || "seasonYear" in obj) return true;
  if ("gameState" in obj && typeof obj.gameState === "object") return true;
  return false;
}

/** Normaliza um save para render + extrai campos pedidos */
function normalizeSave(key, raw) {
  // pode vir {gameState, meta} ou o state direto
  const gs = raw?.gameState && typeof raw.gameState === "object" ? raw.gameState : raw;

  const team = gs?.team || {};
  const teamName = team?.team_name ?? team?.name ?? "Team";
  const teamId =
    team?.team_id ?? team?.id ?? normId(team?.team_name || team?.name || "");

  // Season: tenta vários campos
  const seasonYear =
    gs?.activeYear ??
    gs?.seasonYear ??
    gs?.calendar?.[0]?.year ??
    null;

  // Team Position (supports current `standings.teams` and legacy constructors)
  let teamPosition = "—";
  try {
    const rows = gs?.standings?.teams ?? gs?.standings?.constructors ?? [];
    const row = rows.find((item) => {
      const rowId = item?.team_id ?? item?.constructor_id ?? item?.id ?? null;
      const rowName = item?.team_name ?? item?.name ?? null;
      return (rowId != null && String(rowId) === String(teamId)) ||
        (rowName && String(rowName).toLowerCase() === String(teamName).toLowerCase());
    });
    if (row?.position != null || row?.pos != null) teamPosition = row?.position ?? row?.pos;
  } catch {}

  // Current Day (in-game)
  const currentDayRaw = extractCurrentDayValue(gs, raw);
  const currentDayDate = toDate(currentDayRaw);

  const meta = {
    key,
    name: raw?.meta?.name ?? gs?.save_name ?? teamName ?? "Save",
    seasonYear,
    teamName,
    teamId,
    teamPosition,                         // <- novo
    currentDayISO: currentDayRaw || null, // <- novo
    savedAt: new Date(raw?.meta?.savedAt ?? raw?.savedAt ?? raw?.timestamp ?? Date.now()),
    version: raw?.meta?.version ?? gs?.version ?? "—",
    size: raw?.meta?.size ?? null,
    logo: teamId ? `/logos/teams/${String(teamId).toLowerCase()}.png` : null,
    progressText:
      raw?.meta?.progress ??
      `${(gs?.calendar?.filter?.((x) => x?.done)?.length ?? 0)}/${gs?.calendar?.length ?? 0} events`,
  };

  return {
    key,
    raw,
    gameState: gs,
    meta,
    __currentDayDate: currentDayDate, // opcional (não usado fora)
  };
}

function readLocalSaves() {
  try {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;

      const hasKnownPrefix = SAVE_PREFIXES.some((p) => k.startsWith(p));
      // Internal rolling snapshots (Continue/autosave) are intentionally not
      // shown as manual save cards.
      if (!hasKnownPrefix) continue;

      try {
        const s = localStorage.getItem(k) || "";
        const obj = JSON.parse(s);
        if (isLikelySave(obj)) {
          const norm = normalizeSave(k, obj);
          norm.meta.size = bytesToStr(s.length);
          out.push(norm);
        }
      } catch {}
    }
    out.sort((a, b) => (b.meta.savedAt?.getTime?.() || 0) - (a.meta.savedAt?.getTime?.() || 0));
    return out;
  } catch {
    return [];
  }
}

/* ---------------- component ---------------- */
export default function LoadGame() {
  const {
    gameState,
    setGameState,
    loadGame,
    loadFromKey,
    // opcional em alguns stores:
    loadGameFromSlot, // (id) => void
  } = useGame();
  const navigate = useNavigate();

  const [localSaves, setLocalSaves] = useState([]);
  const [demoSaves, setDemoSaves] = useState([]);
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState("lastPlayedDesc");
  const [dragOver, setDragOver] = useState(false);
  const [confirmingKey, setConfirmingKey] = useState(null);
  const [renamingKey, setRenamingKey] = useState(null);
  const [newName, setNewName] = useState("");
  const [loadingKey, setLoadingKey] = useState(null); // 🔒 evita duplos cliques
  const fileInputRef = useRef(null);

  // ler localStorage
  useEffect(() => {
    setLocalSaves(readLocalSaves());
  }, []);

  // demo saves (opcional)
  useEffect(() => {
    (async () => {
      const js = await tryFetchJSON(["/data/saves.json"]);
      if (Array.isArray(js)) {
        const arr = js.filter(isLikelySave).map((obj, i) => normalizeSave(`demo_${i + 1}`, obj));
        setDemoSaves(arr);
      } else if (js && typeof js === "object" && Array.isArray(js.items)) {
        const arr = js.items.filter(isLikelySave).map((obj, i) => normalizeSave(`demo_${i + 1}`, obj));
        setDemoSaves(arr);
      }
    })();
  }, []);

  const filteredLocal = useMemo(() => {
    let arr = localSaves;
    if (q) {
      const qq = q.toLowerCase();
      arr = arr.filter((s) => {
        const hay = `${s.meta.name} ${s.meta.teamName} ${s.meta.seasonYear} ${s.meta.version}`.toLowerCase();
        return hay.includes(qq);
      });
    }
    arr = [...arr].sort((a, b) => {
      const da = a.meta?.savedAt?.getTime?.() || 0;
      const db = b.meta?.savedAt?.getTime?.() || 0;
      switch (sortBy) {
        case "nameAsc":
          return (a.meta?.name || "").localeCompare(b.meta?.name || "");
        case "nameDesc":
          return (b.meta?.name || "").localeCompare(a.meta?.name || "");
        case "seasonAsc":
          return (a.meta?.seasonYear || 0) - (b.meta?.seasonYear || 0);
        case "seasonDesc":
          return (b.meta?.seasonYear || 0) - (a.meta?.seasonYear || 0);
        case "lastPlayedAsc":
          return da - db;
        case "lastPlayedDesc":
        default:
          return db - da;
      }
    });
    return arr;
  }, [localSaves, q, sortBy]);

  const handleLoad = async (save) => {
    if (!save) return;
    setLoadingKey(save.key);
    try {
      if (typeof loadFromKey === "function" && SAVE_PREFIXES.some((p) => save.key.startsWith(p))) {
        await Promise.resolve(loadFromKey(save.key));
      } else if (typeof loadGameFromSlot === "function") {
        await Promise.resolve(loadGameFromSlot(save.key));
      } else if (typeof loadGame === "function") {
        await Promise.resolve(loadGame(save.gameState));
      } else if (typeof setGameState === "function") {
        setGameState(save.gameState);
      }

      navigate(AFTER_LOAD_ROUTE);
    } catch (e) {
      alert("Falha ao carregar o save. Ver consola para detalhes.");
      // eslint-disable-next-line no-console
      console.error("Load error:", e, save);
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDelete = (save) => {
    if (!save?.key) return;
    try {
      localStorage.removeItem(save.key);
      setLocalSaves((prev) => prev.filter((s) => s.key !== save.key));
    } catch {}
  };

  // Rename: atualiza meta.name no objeto armazenado
  const handleRename = async (key, name) => {
    if (!key || !name?.trim()) return;
    try {
      const text = localStorage.getItem(key);
      if (!text) return;
      const obj = JSON.parse(text);
      const raw = { ...obj };
      const meta = {
        ...(raw.meta || {}),
        name: name.trim(),
        savedAt: raw?.meta?.savedAt ?? Date.now(),
      };
      const updated = { ...raw, meta };
      localStorage.setItem(key, JSON.stringify(updated));
      setLocalSaves((prev) =>
        prev.map((s) => (s.key === key ? normalizeSave(key, updated) : s))
      );
    } catch {}
  };

  const onPickFile = () => fileInputRef.current?.click();

  const onFiles = async (files) => {
    if (!files || !files.length) return;
    const f = files[0];
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      if (!isLikelySave(obj)) {
        alert("JSON não parece um save válido.");
        return;
      }
      const key = `import_${Date.now()}`;
      const norm = normalizeSave(key, obj);
      norm.meta.size = bytesToStr(text.length);
      try {
        localStorage.setItem(norm.key, JSON.stringify(obj));
      } catch {}
      setLocalSaves((prev) => [norm, ...prev]);
    } catch {
      alert("Falha a ler o ficheiro JSON.");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    onFiles(files);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>← Back</Button>
          <Button variant="outline" onClick={() => navigate("/")}>Main Menu</Button>
          <h1 className="text-2xl md:text-3xl font-semibold">Load Game</h1>
        </div>
        <div className="text-sm text-muted-foreground">
          Current:{" "}
          <span className="font-medium">
            {gameState?.team?.team_name ?? gameState?.team?.name ?? "—"}
          </span>
        </div>
      </div>

      {/* Toolbar / Actions */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative w-full md:max-w-sm">
              <input
                type="text"
                placeholder="Search by name, team or season…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="border rounded-xl px-3 py-2 w-full pr-9 shadow-sm"
              />
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </div>
            </div>

            <div className="flex items-center gap-2 md:ml-auto">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="border rounded-xl px-3 py-2 text-sm shadow-sm"
              >
                <option value="lastPlayedDesc">Recent first</option>
                <option value="lastPlayedAsc">Oldest first</option>
                <option value="nameAsc">Name A–Z</option>
                <option value="nameDesc">Name Z–A</option>
                <option value="seasonDesc">Season ↓</option>
                <option value="seasonAsc">Season ↑</option>
              </select>

              <Button variant="outline" onClick={onPickFile}>Import JSON</Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
          </div>

          {/* Dropzone */}
          <div
            className={`mt-3 border-2 border-dashed rounded-2xl p-6 text-center ${
              dragOver ? "border-primary bg-muted/40" : "border-muted"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="text-sm text-muted-foreground">
              Drag & drop a save <span className="text-foreground">.json</span> here to import.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Local saves */}
      <section className="space-y-2">
        <div className="text-sm text-muted-foreground">Local Saves</div>
        {filteredLocal.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No local saves.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredLocal.map((s) => (
              <div key={s.key} className="group relative">
                <SaveCard
                  save={s}
                  loading={loadingKey === s.key}
                  onLoad={() => handleLoad(s)}
                  onDelete={() => setConfirmingKey(s.key)}
                  onStartRename={() => {
                    setRenamingKey(s.key);
                    setNewName(s?.meta?.name || "");
                  }}
                />

                {/* Confirm Delete Modal */}
                {confirmingKey === s.key && (
                  <Modal title="Delete Save?" onClose={() => setConfirmingKey(null)}>
                    <p className="text-sm text-muted-foreground">
                      This action cannot be undone.
                    </p>
                    <div className="mt-5 flex items-center justify-end gap-2">
                      <Button variant="outline" onClick={() => setConfirmingKey(null)}>
                        Cancel
                      </Button>
                      <Button
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => {
                          handleDelete(s);
                          setConfirmingKey(null);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </Modal>
                )}

                {/* Rename Modal */}
                {renamingKey === s.key && (
                  <Modal title="Rename Save" onClose={() => setRenamingKey(null)}>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                      placeholder="New save name"
                    />
                    <div className="mt-5 flex items-center justify-end gap-2">
                      <Button variant="outline" onClick={() => setRenamingKey(null)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={async () => {
                          if (newName.trim()) await handleRename(s.key, newName.trim());
                          setRenamingKey(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </Modal>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Demo saves (opcional) */}
      {demoSaves.length > 0 && (
        <section className="space-y-2">
          <div className="text-sm text-muted-foreground">Demo Saves (from /data/saves.json)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {demoSaves.map((s) => (
              <SaveCard key={s.key} save={s} loading={loadingKey === s.key} onLoad={() => handleLoad(s)} onDelete={null} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- UI bits ---------------- */
function SaveCard({ save, onLoad, onDelete, onStartRename, loading }) {
  const m = save.meta || {};
  const currentDay = toDate(m.currentDayISO);
  const teamPosReadable = Number.isFinite(+m.teamPosition)
    ? ordinalShort(+m.teamPosition)
    : "—";

  return (
    <Card className="border-slate-200 shadow-sm hover:shadow-md transition">
      <CardContent className="p-4 space-y-3">
        {/* Header com logo e nome do save */}
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center ring-1 ring-black/5 shrink-0">
            {m.logo ? (
              <img
                src={m.logo}
                alt={m.teamName}
                className="h-full w-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="h-6 w-6 rounded" style={{ background: "#111827" }} />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium leading-tight truncate">{m.name}</div>
            {/* Team name + season */}
            <div className="text-xs text-muted-foreground truncate">
              {m.teamName}
              {m.seasonYear ? ` • ${m.seasonYear}` : ""}
            </div>
          </div>
        </div>

        {/* Linhas de informação pedidas */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
          <div className="text-muted-foreground">Team Position</div>
          <div className="font-medium">{teamPosReadable}</div>

          <div className="text-muted-foreground">Current Day (in-game)</div>
          <div className="font-medium">{fmtDateOnly(currentDay)}</div>

          <div className="text-muted-foreground">Save Game Date</div>
          <div className="font-medium">{fmtDateTime(m.savedAt)}</div>
        </div>

        {/* progress / meta extra */}
        <div className="text-xs text-muted-foreground">
          {m.progressText || "—"}
          {m.size ? ` • ${m.size}` : ""}
          {m.version ? ` • v${m.version}` : ""}
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onLoad} disabled={loading}>
              {loading ? "Loading…" : "Load"}
            </Button>
            {onDelete ? (
              <Button size="sm" variant="outline" onClick={onDelete} disabled={loading}>
                Delete
              </Button>
            ) : null}
          </div>
          {onStartRename && (
            <Button size="sm" variant="outline" onClick={onStartRename} disabled={loading}>
              Rename
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-semibold">{title}</h4>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted/30"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
