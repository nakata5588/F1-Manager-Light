// src/components/ui/header.jsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./button";
import AdvanceButton from "./AdvanceButton";   // 👈 novo import
import { useGame } from "../../state/GameStore";

/* ==== helpers brand ==== */
function resolvePlayerTeam(gameState) {
  if (gameState?.team) return gameState.team;
  const savedId = gameState?.saveMeta?.teamId ?? gameState?.saveMeta?.team_id ?? gameState?.teamId ?? null;
  if (!savedId) return null;
  return (gameState?.teams || []).find(
    (row) => String(row?.team_id ?? row?.id ?? "") === String(savedId)
  ) || null;
}
function readLS(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function hexToRGBA(hex, alpha = 1) {
  const h = hex?.replace("#", "");
  if (!h || (h.length !== 6 && h.length !== 3)) return `rgba(0,0,0,${alpha})`;
  const f = (s) => parseInt(s.length === 1 ? s + s : s, 16);
  const r = f(h.length === 3 ? h[0] : h.slice(0, 2));
  const g = f(h.length === 3 ? h[1] : h.slice(2, 4));
  const b = f(h.length === 3 ? h[2] : h.slice(4, 6));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function resolveTeamBrand(teamBrands, teamObj) {
  if (!teamBrands?.length) return null;
  const keyId = teamObj?.team_id ?? teamObj?.id ?? null;
  const keyName = teamObj?.team_name ?? teamObj?.name ?? teamObj?.short_name ?? null;

  if (keyId) {
    const byId = teamBrands.find(
      (b) => String(b.team_id).toLowerCase() === String(keyId).toLowerCase()
    );
    if (byId) return byId;
  }
  if (keyName) {
    const byName = teamBrands.find(
      (b) => String(b.team_name).toLowerCase() === String(keyName).toLowerCase()
    );
    if (byName) return byName;
  }

  // último recurso: ler localStorage
  const lsId = readLS("f1ml.team_id");
  const lsName = readLS("f1ml.team_name");
  if (lsId) {
    const byId = teamBrands.find(
      (b) => String(b.team_id).toLowerCase() === String(lsId).toLowerCase()
    );
    if (byId) return byId;
  }
  if (lsName) {
    const byName = teamBrands.find(
      (b) => String(b.team_name).toLowerCase() === String(lsName).toLowerCase()
    );
    if (byName) return byName;
  }
  return null;
}

/* ==== helpers export ==== */
function tsStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (k, v) => {
      if (typeof v === "function") return undefined;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[[Circular]]";
        seen.add(v);
      }
      return v;
    },
    2
  );
}
function downloadJSON(filename, dataObj) {
  const blob = new Blob([safeStringify(dataObj)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Header({ pageTitle = "F1 History Manager" }) {
  const navigate = useNavigate();
  const {
    gameState,
    quickSave,
    saveGame,
    currentSaveKey,
    getTeamLogoCandidates,
    advanceOneDayUntilBreak,
  } = useGame();

  if (!gameState) return null;

  const team = useMemo(() => resolvePlayerTeam(gameState), [gameState]);
  const {
    standings,
    calendar = [],
    currentRound = 0,
    currentDateISO,
    contracts = [],
  } = gameState;

  const [saveOpen, setSaveOpen] = useState(false);
  const saveMenuRef = useRef(null);

  /* ==== carregar brands do public/data ==== */
  const [teamBrands, setTeamBrands] = useState([]);
  useEffect(() => {
    let ok = true;
    fetch("/data/team_brands.json")
      .then((r) => r.json())
      .then((data) => { if (ok) setTeamBrands(Array.isArray(data) ? data : []); })
      .catch(() => setTeamBrands([]));
    return () => { ok = false; };
  }, []);

  // ⚠️ usar primary_color / secondary_color (mesma convenção do Sidebar)
  const brandObj = useMemo(() => resolveTeamBrand(teamBrands, team), [teamBrands, team]);
  const brandPrimary = brandObj?.primary_color || "#111827";   // fundo do header
  const brandSecondary = brandObj?.secondary_color || "#ffffff"; // texto geral
  const borderColor = hexToRGBA(brandSecondary, 0.22);          // borda subtil sobre o fundo

  /* ===== utils ===== */
  const canon = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
  const pick = (obj, keys, fb = undefined) => {
    for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
    return fb;
  };

  const getGpDateISO = (gp) => {
    if (!gp) return "";
    const raw =
      gp.dateISO ||
      gp.date ||
      gp.race_date ||
      gp.start_date ||
      gp.end_date ||
      gp.raceDate ||
      "";
    const s = String(raw || "");
    return s.length >= 10 ? s.slice(0, 10) : "";
  };

  const fromISO = (iso) => {
    if (!iso) return new Date(NaN);
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  };

  const nextGp = calendar[currentRound] ?? null;
  const nextGpDateISO = getGpDateISO(nextGp);

  const daysToNext = useMemo(() => {
    if (!nextGpDateISO || !currentDateISO) return null;
    const d0 = fromISO(currentDateISO);
    const d1 = fromISO(nextGpDateISO);
    const diff = Math.ceil((d1 - d0) / 86_400_000);
    return diff >= 0 ? diff : 0;
  }, [nextGpDateISO, currentDateISO]);

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

  const teamStanding = useMemo(() => {
    const teamId = String(team?.team_id ?? team?.id ?? "");
    const teamName = String(team?.team_name ?? team?.name ?? "");
    const row = (standings?.teams ?? standings?.constructors ?? []).find((item) => {
      const rowId = String(item?.team_id ?? item?.constructor_id ?? item?.id ?? "");
      const rowName = String(item?.team_name ?? item?.name ?? "");
      return (teamId && rowId === teamId) || (teamName && rowName === teamName);
    });
    return {
      position: row?.position ?? row?.pos ?? "—",
      points: row?.points ?? row?.pts ?? 0,
    };
  }, [standings, team]);

  const teamDriversResolved = useMemo(() => {
    if (!team) return [];
    const teamKey =
      team.team_id ?? team.id ?? team.team_name ?? team.name ?? team.short_name ?? null;
    const teamIdC = canon(teamKey);
    const teamNameC = canon(team.team_name ?? team.name ?? team.short_name ?? "");

    const sameTeam = (c) => {
      const cid = canon(pick(c, ["team_id", "constructor_id", "constructor", "id"]));
      const cname = canon(pick(c, ["team_name", "team", "constructor", "name", "short_name"]));
      return (teamIdC && cid && teamIdC === cid) || (teamNameC && cname && teamNameC === cname);
    };

    const seatRank = (c) => {
      const seatRaw = (c.seat ?? c.role ?? c.position ?? c.status ?? "").toString().toLowerCase();
      if (/driver\s*1|\b#?1\b|lead|primary|main/.test(seatRaw)) return 1;
      if (/driver\s*2|\b#?2\b|second/.test(seatRaw)) return 2;
      if (/reserve|test|junior/.test(seatRaw)) return 90;
      const ord = Number(c.order ?? c.priority ?? c.sort ?? c.seat_number ?? NaN);
      if (Number.isFinite(ord)) return ord;
      return 50;
    };

    const nameFromContract = (c) => {
      const first = c.first_name ?? c.firstname ?? c.given_name ?? c.forename ?? c.first ?? "";
      const last = c.last_name ?? c.lastname ?? c.family_name ?? c.surname ?? c.last ?? "";
      const combo = `${first} ${last}`.trim();
      return c.driver_name || c.name || combo || c.code || c.driver || "";
    };

    const teamContracts = (contracts || []).filter(sameTeam);
    teamContracts.sort((a, b) => {
      const ra = seatRank(a);
      const rb = seatRank(b);
      if (ra !== rb) return ra - rb;
      const sa = getGpDateISO({ date: a.start_date || a.from || a.year_start || "" });
      const sb = getGpDateISO({ date: b.start_date || b.from || b.year_start || "" });
      return (sb || "").localeCompare(sa || "");
    });

    const seen = new Set();
    const out = [];
    for (const c of teamContracts) {
      const name = nameFromContract(c);
      if (!name) continue;
      const key = canon(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, contract: c });
      if (out.length >= 2) break;
    }
    return out;
  }, [contracts, team]);

  const driversRows = useMemo(() => {
    const byId = new Map();
    const byName = new Map();
    for (const d of standings?.drivers ?? []) {
      const stats = {
        pos: d?.position ?? d?.pos ?? "—",
        pts: d?.points ?? d?.pts ?? 0,
      };
      const id = String(d?.driver_id ?? d?.id ?? "");
      const name = String(d?.name ?? "");
      if (id) byId.set(id, stats);
      if (name) byName.set(name, stats);
    }
    return teamDriversResolved.map(({ name, contract }) => {
      const driverId = String(pick(contract, ["driver_id", "person_id", "id"], ""));
      const stats = byId.get(driverId) || byName.get(name);
      return { name, pos: stats?.pos ?? "—", pts: stats?.pts ?? 0 };
    });
  }, [teamDriversResolved, standings]);

  const ordinalShort = (n) => {
    if (n == null || !Number.isFinite(+n)) return "—";
    const num = +n;
    const s = ["th", "st", "nd", "rd"], v = num % 100;
    return num + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /* ===== evitar duplos saves ===== */
  const savingRef = useRef(false);
  const runOnce = async (fn) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await fn();
    } finally {
      // liberta no próximo tick para não apanhar eventos encadeados
      setTimeout(() => { savingRef.current = false; }, 0);
    }
  };

  /* ===== save actions ===== */
  const handleQuickSave = () =>
    runOnce(() => {
      const res = quickSave();
      toastMini(res?.meta?.name ? `Saved: ${res.meta.name}` : "Saved.");
      setSaveOpen(false);
    });

  const handleSaveAs = () =>
    runOnce(() => {
      const suggested = defaultName(gameState);
      const name = window.prompt("Save name:", suggested);
      if (!name) return;
      const res = saveGame({ name: String(name).trim() || suggested });
      toastMini(res?.meta?.name ? `Saved: ${res.meta.name}` : "Saved.");
      setSaveOpen(false);
    });

  const handleSaveToSlot = () =>
    runOnce(() => {
      const ans = window.prompt("Save to slot (1–5):", "1");
      const idx = Number(ans);
      if (!Number.isInteger(idx) || idx < 1 || idx > 5) return;
      const base = defaultName(gameState);
      const res = saveGame({ name: `${base} — Slot ${idx}` });
      toastMini(res?.meta?.name ? `Saved: ${res.meta.name}` : "Saved.");
      setSaveOpen(false);
    });

  const handleSaveOverwrite = () =>
    runOnce(() => {
      if (!currentSaveKey) return;
      const res = saveGame({ overwriteKey: currentSaveKey });
      toastMini(res?.meta?.name ? `Saved (overwrite): ${res.meta.name}` : "Saved.");
      setSaveOpen(false);
    });

  const canOverwrite = Boolean(currentSaveKey);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (!saveOpen) return;
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target)) {
        setSaveOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [saveOpen]);

  /* ===== logo ===== */
  const [logoSrc, setLogoSrc] = useState(null);
  useEffect(() => {
    if (!team) return setLogoSrc(null);
    const cands =
      typeof getTeamLogoCandidates === "function"
        ? getTeamLogoCandidates(team)
        : [];
    if (!cands?.length) return setLogoSrc(null);
    let i = 0;
    setLogoSrc(cands[0]);
    const probe = new Image();
    probe.onload = () => setLogoSrc(cands[i]);
    probe.onerror = () => {
      i += 1;
      if (i < cands.length) probe.src = cands[i];
    };
    probe.src = cands[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  return (
    <div
      className="sticky top-0 z-10 border-b"
      style={{
        background: brandPrimary,        // fundo geral = primary_color
        color: brandSecondary,           // texto geral = secondary_color
        borderColor,                     // borda subtil derivada do secondary
      }}
    >
      <div className="w-full px-4 h-16 flex items-stretch">
        <div className="w-full flex items-start justify-between gap-6">
          {/* LOGO */}
          <div
            className="h-full w-16 rounded-lg overflow-hidden ring-1 flex items-center justify-center shrink-0"
            style={{
              background: "#ffffffE6",     // branco translúcido para legibilidade
              ringColor: borderColor,
            }}
          >
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={team?.name}
                className="max-h-full max-w-full object-contain"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            ) : (
              <span className="text-sm" style={{ color: "#374151" }}>
                {(team?.name || "—").split(" ").map((x) => x[0]).join("").slice(0, 2)}
              </span>
            )}
          </div>

          {/* CLASSIFICAÇÕES */}
          <div className="min-w-[280px] text-sm pt-2">
            <div>
              <span style={{ opacity: 0.9 }}>Team</span>{" "}
              <span className="font-semibold">{teamStanding.points} pts</span>{" "}
              <span style={{ opacity: 0.9 }}>
                ({ordinalShort(teamStanding.position)})
              </span>
            </div>
            <div className="flex gap-4">
              <div>
                <span style={{ opacity: 0.9 }}>
                  {teamDriversResolved?.[0]?.name || "—"}
                </span>{" "}
                <span className="font-semibold">
                  {driversRows?.[0]?.pts ?? 0} pts
                </span>{" "}
                <span style={{ opacity: 0.9 }}>
                  ({ordinalShort(driversRows?.[0]?.pos)})
                </span>
              </div>
              <div>
                <span style={{ opacity: 0.9 }}>
                  {teamDriversResolved?.[1]?.name || "—"}
                </span>{" "}
                <span className="font-semibold">
                  {driversRows?.[1]?.pts ?? 0} pts
                </span>{" "}
                <span style={{ opacity: 0.9 }}>
                  ({ordinalShort(driversRows?.[1]?.pos)})
                </span>
              </div>
            </div>
          </div>

          {/* TÍTULO */}
          <div className="flex-1 min-w-[140px] flex items-center justify-center pt-2">
            <div className="text-lg font-semibold drop-shadow-sm">{pageTitle}</div>
          </div>

          {/* NEXT GP */}
          <div className="min-w-[260px] pt-2">
            <div className="text-sm">
              NEXT GP: <span className="font-semibold">{nextGp?.name ?? "—"}</span>
              {Number.isInteger(daysToNext) ? ` • in ${daysToNext} days` : ""}
            </div>
            <div className="text-xs" style={{ opacity: 0.9 }}>
              {nextGpDateISO || "TBD"}
            </div>
          </div>

          {/* COLUNA DIREITA */}
          <div className="flex flex-col items-end justify-between py-2 gap-2 shrink-0">
            {/* “Selecionado” (chip) — inverso: fundo secondary, texto/borda primary */}
            <div
              className="inline-flex items-center h-5 px-4 rounded-full text-sm font-semibold select-none"
              title="Current in-game date"
              style={{
                background: brandSecondary,
                color: brandPrimary,
                border: "1px solid currentColor",
              }}
            >
              {gameDateStr}
            </div>

            <div className="flex items-center gap-2">
              {/* Botões outline com texto/borda = secondary (igual Sidebar) */}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("/")}
                className="h-6 px-2.5 text-xs whitespace-nowrap"
                style={{
                  background: "transparent",
                  color: brandSecondary,
                  border: "1px solid currentColor",
                }}
              >
                Main Menu
              </Button>

              <div className="relative" ref={saveMenuRef}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSaveOpen((o) => !o)}
                  className="h-6 px-2.5 text-xs whitespace-nowrap"
                  style={{
                    background: "transparent",
                    color: brandSecondary,
                    border: "1px solid currentColor",
                  }}
                >
                  Save Game
                </Button>

                {saveOpen && (
                  <div
                    className="absolute right-0 top-[110%] w-56 border rounded-xl shadow p-1 bg-white text-neutral-800 z-50"
                    style={{ borderColor }}
                    role="menu"
                  >
                    <button
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-100 text-sm"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleQuickSave(); }}
                      title="Ctrl/Cmd + S"
                    >
                      Quick Save
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-100 text-sm"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSaveAs(); }}
                      title="Ctrl/Cmd + Shift + S"
                    >
                      Save As…
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-100 text-sm"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSaveToSlot(); }}
                    >
                      Save to slot…
                    </button>
                    <button
                      disabled={!canOverwrite}
                      className={`w-full text-left px-3 py-2 rounded-md hover:bg-neutral-100 text-sm ${
                        !canOverwrite ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                      onClick={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        handleSaveOverwrite();
                      }}
                      title={
                        canOverwrite
                          ? "Overwrite current save"
                          : "Open a save from Load to enable"
                      }
                    >
                      Save (overwrite)
                    </button>

                    <div className="my-1 h-px bg-neutral-200" />

                    {/* --- Export Save --- */}
                    <button
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-100 text-sm"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExportSave(); }}
                      title="Export current game state as JSON"
                    >
                      Export Save (.json)
                    </button>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("/LoadGame")}
                className="h-6 px-2.5 text-xs whitespace-nowrap"
                style={{
                  background: "transparent",
                  color: brandSecondary,
                  border: "1px solid currentColor",
                }}
              >
                Load Game
              </Button>

              <AdvanceButton
                className="h-6 px-2.5 text-xs whitespace-nowrap"
                style={{
                  background: "transparent",
                  color: brandSecondary,
                  border: "1px solid currentColor",
                }}
              >
                Advance
              </AdvanceButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Helpers */
function defaultName(gs) {
  const team = gs?.team?.team_name || gs?.team?.name || "Save";
  const season = gs?.activeYear || gs?.seasonYear || "";
  return `${team}${season ? ` — ${season}` : ""}`;
}
function toastMini(msg) {
  // eslint-disable-next-line no-console
  console.log("[SAVE]", msg);
}
