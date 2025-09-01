// src/pages/LoadGame.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { useNavigate } from "react-router-dom";

/* ---------------- utils ---------------- */
const SAVE_PREFIXES = ["f1ml_save_", "save_", "f1manager_"];

const tryFetchJSON = async (paths) => {
  for (const p of paths) {
    try { const r = await fetch(p); if (r.ok) return await r.json(); } catch {}
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
    ? d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

const bytesToStr = (b) => {
  const n = Number(b || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

function isLikelySave(obj) {
  if (!obj || typeof obj !== "object") return false;
  // heurísticas leves
  if ("team" in obj || "calendar" in obj || "seasonYear" in obj) return true;
  if ("gameState" in obj && typeof obj.gameState === "object") return true;
  return false;
}

/** Normaliza um save para render */
function normalizeSave(key, raw) {
  // pode vir {gameState, meta} ou o state direto
  const gs = raw?.gameState && typeof raw.gameState === "object" ? raw.gameState : raw;
  const team = gs?.team || {};
  const teamId = team?.team_id ?? team?.id ?? normId(team?.team_name || team?.name || "");
  const season = gs?.seasonYear ?? gs?.calendar?.[0]?.year ?? null;

  const meta = {
    key,
    name: raw?.meta?.name ?? gs?.save_name ?? team?.team_name ?? team?.name ?? "Save",
    seasonYear: season,
    teamName: team?.team_name ?? team?.name ?? "Team",
    teamId,
    progressText: raw?.meta?.progress ?? `${(gs?.calendar?.filter?.((x) => x?.done)?.length ?? 0)}/${gs?.calendar?.length ?? 0} events`,
    savedAt: new Date(raw?.meta?.savedAt ?? raw?.savedAt ?? raw?.timestamp ?? Date.now()),
    version: raw?.meta?.version ?? gs?.version ?? "—",
    size: raw?.meta?.size ?? null,
    logo: teamId ? `/logos/teams/${String(teamId).toLowerCase()}.png` : null,
  };

  return {
    key,
    raw,
    gameState: gs,
    meta,
  };
}

function readLocalSaves() {
  try {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!SAVE_PREFIXES.some((p) => k.startsWith(p))) continue;
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
    // ordenar por data desc (quando disponível)
    out.sort((a, b) => (b.meta.savedAt?.getTime?.() || 0) - (a.meta.savedAt?.getTime?.() || 0));
    return out;
  } catch {
    return [];
  }
}

/* ---------------- component ---------------- */
export default function LoadGame() {
  const { gameState, setGameState, loadGame } = useGame();
  const navigate = useNavigate();

  const [localSaves, setLocalSaves] = useState([]);
  const [demoSaves, setDemoSaves] = useState([]);
  const [q, setQ] = useState("");
  const [dragOver, setDragOver] = useState(false);
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
        const arr = js
          .filter(isLikelySave)
          .map((obj, i) => normalizeSave(`demo_${i + 1}`, obj));
        setDemoSaves(arr);
      } else if (js && typeof js === "object" && Array.isArray(js.items)) {
        const arr = js.items.filter(isLikelySave).map((obj, i) => normalizeSave(`demo_${i + 1}`, obj));
        setDemoSaves(arr);
      }
    })();
  }, []);

  const filteredLocal = useMemo(() => {
    if (!q) return localSaves;
    const qq = q.toLowerCase();
    return localSaves.filter((s) => {
      const hay = `${s.meta.name} ${s.meta.teamName} ${s.meta.seasonYear} ${s.meta.version}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [localSaves, q]);

  const handleLoad = (save) => {
    // tenta métodos do GameStore
    try {
      if (typeof loadGame === "function") {
        loadGame(save.gameState);
        navigate("/");
        return;
      }
      if (typeof setGameState === "function") {
        setGameState(save.gameState);
        navigate("/");
        return;
      }
    } catch {}
    // fallback: guardar num staging e recarregar
    try {
      localStorage.setItem("f1ml_current_game", JSON.stringify(save));
      window.location.assign("/");
    } catch {
      alert("Could not load the save automatically. Check console.");
      // console fallback
      // eslint-disable-next-line no-console
      console.log("Save to load:", save);
    }
  };

  const handleDelete = (save) => {
    if (!save?.key) return;
    if (!confirm("Delete this save from local storage?")) return;
    try {
      localStorage.removeItem(save.key);
      setLocalSaves((prev) => prev.filter((s) => s.key !== save.key));
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
      const norm = normalizeSave(`import_${Date.now()}`, obj);
      norm.meta.size = bytesToStr(text.length);
      // guardar local
      try {
        localStorage.setItem(norm.key, JSON.stringify(obj));
      } catch {}
      setLocalSaves((prev) => [norm, ...prev]);
    } catch (e) {
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
        <h1 className="text-2xl md:text-3xl font-semibold">Load Game</h1>
        <div className="text-sm text-muted-foreground">
          Current: <span className="font-medium">{gameState?.team?.team_name ?? gameState?.team?.name ?? "—"}</span>
        </div>
      </div>

      {/* Actions */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <input
              type="text"
              placeholder="Search saves…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />
            <div className="flex-1" />
            <Button variant="outline" onClick={onPickFile}>Import JSON</Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>

          {/* Dropzone */}
          <div
            className={`mt-3 border-2 border-dashed rounded-lg p-6 text-center ${dragOver ? "border-primary bg-muted/40" : "border-muted"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
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
          <Card><CardContent className="p-4 text-sm text-muted-foreground">No local saves.</CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredLocal.map((s) => <SaveCard key={s.key} save={s} onLoad={() => handleLoad(s)} onDelete={() => handleDelete(s)} />)}
          </div>
        )}
      </section>

      {/* Demo saves (opcional) */}
      {demoSaves.length > 0 && (
        <section className="space-y-2">
          <div className="text-sm text-muted-foreground">Demo Saves (from /data/saves.json)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {demoSaves.map((s) => <SaveCard key={s.key} save={s} onLoad={() => handleLoad(s)} onDelete={null} />)}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------- UI bits ---------------- */
function SaveCard({ save, onLoad, onDelete }) {
  const m = save.meta || {};
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center ring-1 ring-black/5 shrink-0">
            {m.logo ? (
              <img
                src={m.logo}
                alt={m.teamName}
                className="h-full w-full object-contain"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            ) : (
              <div className="h-6 w-6 rounded" style={{ background: "#111827" }} />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium leading-tight truncate">{m.name}</div>
            <div className="text-xs text-muted-foreground truncate">{m.teamName}{m.seasonYear ? ` • ${m.seasonYear}` : ""}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Saved: {fmtDateTime(m.savedAt)}{m.size ? ` • ${m.size}` : ""}{m.version ? ` • v${m.version}` : ""}
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          {m.progressText || "—"}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onLoad}>Load</Button>
          {onDelete ? <Button size="sm" variant="outline" onClick={onDelete}>Delete</Button> : null}
        </div>
      </CardContent>
    </Card>
  );
}
