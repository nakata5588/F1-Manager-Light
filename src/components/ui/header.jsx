import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./button";
import { useGame } from "../../state/GameStore";

export default function Header({ pageTitle = "Main" }) {
  const navigate = useNavigate();
  const {
    gameState,
    saveGame,
    saveGameToSlot,
    currentSlot,
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

  // Data in-game formatada (en-GB)
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

  // --- TEAM STANDING (com fallback) ---
  const teamStanding = useMemo(() => {
    const row = standings?.constructors?.find(
      (c) => c.name === (team?.name ?? "")
    );
    return { position: row?.pos ?? "—", points: row?.pts ?? 0 };
  }, [standings, team]);

  // --- DRIVERS (com fallback; usa drivers do plantel) ---
  const driversRows = useMemo(() => {
    const teamDrivers = (team?.drivers ?? []).slice(0, 2); // até 2
    const table = new Map(
      (standings?.drivers ?? []).map((d) => [d.name, { pos: d.pos, pts: d.pts }])
    );

    const rows = teamDrivers.map((d) => {
      const stats = table.get(d.name);
      return {
        name: d.name,
        pos: stats?.pos ?? "—",
        pts: stats?.pts ?? 0,
      };
    });

    // ordena por: quem tiver posição numérica vem antes; depois por menor posição; se não houver posição, por pts desc
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
    const s = ["th", "st", "nd", "rd"],
      v = num % 100;
    return num + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const handleSaveSame = () => {
    saveGame();
    setSaveOpen(false);
  };
  const handleSaveNew = () => {
    const ans = window.prompt(
      `Save to which slot? (1–5)\nCurrent: ${
        typeof currentSlot === "number" ? currentSlot + 1 : "—"
      }`
    );
    const idx = Number(ans) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < 5) {
      saveGameToSlot(idx);
      setSaveOpen(false);
    }
  };

  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-neutral-200">
      <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-4">
        {/* ESQUERDA — Nome + (mantemos o bloco como tinhas, sem a data aqui) */}
        <div className="min-w-[520px]">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <div className="font-semibold text-lg leading-6">
                {team?.name ?? "—"}
              </div>
              {/* a data saiu daqui */}
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

        {/* CENTRO — Page title + NEXT GP + (data por baixo) */}
        <div className="flex-1 text-center">
          <div className="inline-flex flex-col items-center">
            <div className="inline-flex items-center gap-3">
              <span className="text-xl font-semibold">{pageTitle}</span>
              {nextGp && (
                <span className="text-sm text-neutral-600">
                  {" "}
                  • NEXT GP:{" "}
                  <span className="font-medium">{nextGp.name}</span> — in{" "}
                  {daysToNext} days
                </span>
              )}
            </div>
            {/* Data do jogo por baixo do NEXT GP */}
            <div className="text-xs text-neutral-600 mt-1">{gameDateStr}</div>
          </div>
        </div>

        {/* DIREITA — Back / Advance / Save (com submenu) */}
        <div className="flex items-center gap-2 relative">
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="whitespace-nowrap"
          >
            ← Back
          </Button>
          <Button
            onClick={advanceOneDayUntilBreak}
            className="whitespace-nowrap"
          >
            Advance
          </Button>
          <Button
            variant="muted"
            onClick={() => setSaveOpen((o) => !o)}
            onBlur={() => setTimeout(() => setSaveOpen(false), 150)}
            className="whitespace-nowrap"
          >
            Save {typeof currentSlot === "number" ? `(Slot ${currentSlot + 1})` : ""}
          </Button>
          {saveOpen && (
            <div className="absolute right-0 top-[110%] w-56 bg-white border rounded-xl shadow p-1">
              <button
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50"
                onMouseDown={handleSaveSame}
              >
                Save in same slot
              </button>
              <button
                className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-50"
                onMouseDown={handleSaveNew}
              >
                Save to new slot…
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
