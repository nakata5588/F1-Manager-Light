import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./button";
import { useGame } from "../../state/GameStore";

export default function Header({ pageTitle = "Main" }) {
  const navigate = useNavigate();
  const {
    gameState,
    // multi-save API
    quickSave,
    saveGame,
    currentSaveKey,
    getTeamLogoCandidates, // <- para logo
    // sim
    advanceOneDayUntilBreak,
  } = useGame();

  if (!gameState) return null;

  const { team, standings, calendar = [], currentRound = 0, currentDateISO } = gameState;
  const [saveOpen, setSaveOpen] = useState(false);

  // === helpers de data (UTC safe) ===
  const fromISO = (iso) => {
    if (!iso) return new Date(NaN);
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  };

  // Próximo GP e dias até lá
  const nextGp = calendar[currentRound] ?? null;
  const daysToNext = useMemo(() => {
    if (!nextGp?.date || !currentDateISO) return "-";
    const d0 = fromISO(currentDateISO);
    const d1 = fromISO(nextGp.date);
    const diff = Math.ceil((d1 - d0) / 86_400_000);
    return diff >= 0 ? diff : 0;
  }, [nextGp, currentDateISO]);

  // Data in-game
  const gameDateStr = useMemo(() => {
    if (!currentDateISO) return "—";
    const d = fromISO(currentDateISO);
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }, [currentDateISO]);

  // TEAM STANDING (da tua equipa)
  const teamStanding = useMemo(() => {
    const row = (standings?.constructors ?? []).find(
      (c) => c.name === (team?.name ?? "")
    );
    return { position: row?.pos ?? "—", points: row?.pts ?? 0 };
  }, [standings, team]);

  // DRIVERS (dupla)
  const driversRows = useMemo(() => {
    const teamDrivers = (team?.drivers ?? []).slice(0, 2);
    const table = new Map(
      (standings?.drivers ?? []).map((d) => [d.name, { pos: d.pos, pts: d.pts }])
    );
    const rows = teamDrivers.map((d) => {
      const stats = table.get(d.name);
      return { name: d.name, pos: stats?.pos ?? "—", pts: stats?.pts ?? 0 };
    });
    return rows.sort((a, b) => {
      const aNum = Number.isFinite(+a.pos);
      const bNum = Number.isFinite(+b.pos);
      if (aNum && bNum) return a.pos - b.pos;
      if (aNum) return -1;
      if (bNum) return 1;
      return b.pts - a.pts;
    });
  }, [standings, team]);

  const ordinalShort = (n) => {
    if (n == null || !Number.isFinite(+n)) return "—";
    const num = +n;
    const s = ["th", "st", "nd", "rd"], v = num % 100;
    return num + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /* ───────────────
     AÇÕES SAVE
     ─────────────── */
  const handleQuickSave = () => {
    const res = quickSave();
    toastMini(res?.meta?.name ? `Saved: ${res.meta.name}` : "Saved.");
    setSaveOpen(false);
  };

  const handleSaveAs = () => {
    const suggested = defaultName(gameState);
    const name = window.prompt("Save name:", suggested);
    if (!name) return;
    const res = saveGame({ name: String(name).trim() || suggested });
    toastMini(res?.meta?.name ? `Saved: ${res.meta.name}` : "Saved.");
    setSaveOpen(false);
  };

  const handleSaveToSlot = () => {
    const ans = window.prompt("Save to slot (1–5):", "1");
    const idx = Number(ans);
    if (!Number.isInteger(idx) || idx < 1 || idx > 5) return;
    const base = defaultName(gameState);
    const res = saveGame({ name: `${base} — Slot ${idx}` });
    toastMini(res?.meta?.name ? `Saved: ${res.meta.name}` : "Saved.");
    setSaveOpen(false);
  };

  const handleSaveOverwrite = () => {
    if (!currentSaveKey) return;
    const res = saveGame({ overwriteKey: currentSaveKey });
    toastMini(res?.meta?.name ? `Saved (overwrite): ${res.meta.name}` : "Saved.");
    setSaveOpen(false);
  };

  const canOverwrite = Boolean(currentSaveKey);

  /* ───────────────
     LOGO (candidatos)
     ─────────────── */
  const [logoSrc, setLogoSrc] = useState(null);
  useEffect(() => {
    if (!team) return setLogoSrc(null);
    const cands = typeof getTeamLogoCandidates === "function" ? getTeamLogoCandidates(team) : [];
    if (!cands?.length) return setLogoSrc(null);
    let i = 0;
    setLogoSrc(cands[0]);
    const onError = () => {
      i += 1;
      if (i < cands.length) setLogoSrc(cands[i]);
    };
    const img = new Image();
    img.onerror = onError;
    img.onload = () => setLogoSrc(cands[i]);
    img.src = cands[0];
    // cleanup não necessário aqui
  }, [team, getTeamLogoCandidates]);

  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-neutral-200">
      <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-4">
        {/* ESQUERDA — Logo + Nome + info da equipa */}
        <div className="min-w-[520px]">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg overflow-hidden bg-neutral-100 ring-1 ring-black/5 flex items-center justify-center shrink-0">
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt={team?.name}
                  className="h-full w-full object-contain"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : (
                <span className="text-xs text-neutral-500 px-1">
                  {(team?.name || "—").split(" ").map((x) => x[0]).join("").slice(0, 2)}
                </span>
              )}
            </div>

            <div className="shrink-0">
              <div className="font-semibold text-lg leading-6">
                {team?.name ?? "—"}
              </div>
            </div>
          </div>

          {/* separador fino */}
          <div className="h-px bg-neutral-200 my-2" />

          {/* Linhas com classificações/pontos */}
          <div className="text-sm text-neutral-800 space-y-1">
            {/* Team */}
            <div>
              <span className="text-neutral-600">Team</span>{" "}
              <>
                <span className="font-medium">{teamStanding.points} pts</span>{" "}
                <span className="text-neutral-500">
                  ({ordinalShort(teamStanding.position)})
                </span>
              </>
            </div>
            {/* Driver 1 */}
            <div>
              <span className="text-neutral-600">
                {driversRows?.[0]?.name ?? "Driver 1"}
              </span>{" "}
              <>
                <span className="font-medium">
                  {driversRows?.[0]?.pts ?? 0} pts
                </span>{" "}
                <span className="text-neutral-500">
                  ({ordinalShort(driversRows?.[0]?.pos)})
                </span>
              </>
            </div>
            {/* Driver 2 */}
            <div>
              <span className="text-neutral-600">
                {driversRows?.[1]?.name ?? "Driver 2"}
              </span>{" "}
              <>
                <span className="font-medium">
                  {driversRows?.[1]?.pts ?? 0} pts
                </span>{" "}
                <span className="text-neutral-500">
                  ({ordinalShort(driversRows?.[1]?.pos)})
                </span>
              </>
            </div>
          </div>
        </div>

        {/* CENTRO — Page title + NEXT GP + classificação/pts + data */}
        <div className="flex-1 text-center">
          <div className="inline-flex flex-col items-center">
            <div className="inline-flex items-center gap-3">
              <span className="text-xl font-semibold">{pageTitle}</span>
              <span className="text-sm text-neutral-600">
                • NEXT GP:{" "}
                <span className="font-medium">{nextGp?.name ?? "—"}</span>
                {" — "}
                <span>
                  Team {ordinalShort(teamStanding.position)} • {teamStanding.points} pts
                </span>
                {typeof daysToNext === "number" ? ` • in ${daysToNext} days` : ""}
              </span>
            </div>
            <div className="text-xs text-neutral-600 mt-1">{gameDateStr}</div>
          </div>
        </div>

        {/* DIREITA — Main Menu / Save Game / Load Game / Advance */}
        <div className="flex items-center gap-2 relative">
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="whitespace-nowrap"
          >
            Main Menu
          </Button>

          <Button
            variant="muted"
            onClick={() => setSaveOpen((o) => !o)}
            onBlur={() => setTimeout(() => setSaveOpen(false), 150)}
            className="whitespace-nowrap"
          >
            Save Game
          </Button>

          {saveOpen && (
            <div className="absolute right-28 top-[110%] w-56 bg-white border rounded-xl shadow p-1">
              <button
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50"
                onMouseDown={handleQuickSave}
                title="Ctrl/Cmd + S"
              >
                Quick Save
              </button>
              <button
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50"
                onMouseDown={handleSaveAs}
                title="Ctrl/Cmd + Shift + S"
              >
                Save As…
              </button>
              <button
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50"
                onMouseDown={handleSaveToSlot}
              >
                Save to slot…
              </button>
              <button
                disabled={!canOverwrite}
                className={`w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50 ${!canOverwrite ? "opacity-50 cursor-not-allowed" : ""}`}
                onMouseDown={handleSaveOverwrite}
                title={canOverwrite ? "Overwrite current save" : "Open a save from Load to enable"}
              >
                Save (overwrite)
              </button>
            </div>
          )}

          <Button
            variant="outline"
            onClick={() => navigate("/load")}
            className="whitespace-nowrap"
          >
            Load Game
          </Button>

          <Button
            onClick={advanceOneDayUntilBreak}
            className="whitespace-nowrap"
          >
            Advance
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Helpers locais */
function defaultName(gs) {
  const team = gs?.team?.team_name || gs?.team?.name || "Save";
  const season = gs?.activeYear || gs?.seasonYear || "";
  return `${team}${season ? ` — ${season}` : ""}`;
}

function toastMini(msg) {
  // eslint-disable-next-line no-console
  console.log("[SAVE]", msg);
}
