// src/pages/AssetTest.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "@/state/GameStore";
import { Button } from "@/components/ui/button";

export default function AssetTest() {
  const {
    gameState,
    getTeamLogoCandidates,   // do GameStore
  } = useGame();

  const {
    teams = [],
    teamBrands = [],
    teamEngines = [],
    contracts = [],
    drivers = [],
    activeYear,
    team: userTeam,
  } = gameState || {};

  // seleção de equipa para teste (default: equipa do utilizador)
  const [teamId, setTeamId] = useState(() => userTeam?.team_id ?? teams?.[0]?.team_id);

  useEffect(() => {
    if (!teamId && teams?.length) setTeamId(teams[0].team_id);
  }, [teams, teamId]);

  const selectedTeam = useMemo(
    () => (teams || []).find(t => String(t.team_id) === String(teamId)) || null,
    [teams, teamId]
  );

  // --- helpers gerais ---
  const canon = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
  const pick = (obj, keys, fb = undefined) => {
    for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
    return fb;
  };

  // BRAND record desta equipa
  const brand = useMemo(() => {
    if (!selectedTeam) return null;
    const idC = canon(selectedTeam.team_id);
    const nameC = canon(selectedTeam.team_name ?? selectedTeam.name ?? selectedTeam.short_name);
    return (teamBrands || []).find(b => {
      const bid = canon(pick(b, ["team_id", "constructor_id", "id", "team"]));
      const bname = canon(pick(b, ["team_name", "name", "short_name", "constructor"]));
      return (idC && bid && idC === bid) || (nameC && bname && nameC === bname);
    }) || null;
  }, [selectedTeam, teamBrands]);

  // cores
  const primary = pick(brand, ["primary_color", "color_primary", "primary"], "#777777");
  const secondary = pick(brand, ["secondary_color", "color_secondary", "secondary"], "#BBBBBB");

  // motor
  const engineName = useMemo(() => {
    if (!selectedTeam) return null;
    const idC = canon(selectedTeam.team_id);
    const nameC = canon(selectedTeam.team_name ?? selectedTeam.name ?? selectedTeam.short_name);
    const rec = (teamEngines || []).find(e => {
      const eid = canon(pick(e, ["team_id", "constructor_id", "id", "team"]));
      const ename = canon(pick(e, ["team_name", "name", "short_name", "constructor"]));
      return (idC && eid && idC === eid) || (nameC && ename && nameC === ename);
    });
    return pick(rec, ["engine_name", "pu_name", "supplier", "name"], null);
  }, [selectedTeam, teamEngines]);

  // contratos -> pilotos da equipa (assentos Race Driver 1/2 prioritários)
  const teamDrivers = useMemo(() => {
    if (!selectedTeam) return [];
    const tNameC = canon(selectedTeam.team_name ?? selectedTeam.name ?? selectedTeam.short_name);
    const sameTeam = (c) => canon(c.team_name ?? c.team ?? c.constructor) === tNameC;

    const seatRank = (c) => {
      const seatRaw = (c.seat ?? c.role ?? c.position ?? c.status ?? "").toString().toLowerCase();
      if (/driver\s*1|\b#?1\b|lead|primary|main/.test(seatRaw)) return 1;
      if (/driver\s*2|\b#?2\b|second/.test(seatRaw)) return 2;
      if (/reserve|test|junior/.test(seatRaw)) return 90;
      return 50;
    };

    const nameFromContract = (c) => {
      const first = c.first_name ?? c.firstname ?? "";
      const last = c.last_name ?? c.lastname ?? "";
      const combo = `${first} ${last}`.trim();
      return c.driver_name || c.name || combo || c.code || "";
    };

    const filtered = (contracts || []).filter(sameTeam).sort((a,b) => seatRank(a) - seatRank(b));
    const unique = [];
    const seen = new Set();
    for (const c of filtered) {
      const name = nameFromContract(c);
      if (!name) continue;
      const key = canon(name);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ name, seat: c.seat ?? c.role ?? "", contract: c });
      if (unique.length >= 4) break; // mostra até 4 para testes
    }
    return unique;
  }, [selectedTeam, contracts]);

  // portrait helper (tenta caminhos comuns)
  const resolvePortrait = (dName) => {
    // tentar encontrar no array global de drivers por nome aproximado
    const idx = (drivers || []).find(
      d => canon(d.display_name || d.driver_name || d.name) === canon(dName)
    );
    const explicit = idx?.portrait_path || idx?.portrait;
    const candidates = [
      explicit,
      `/portraits/${idx?.driver_id || idx?.id || canon(dName)}.png`,
      `/portraits/${canon(dName)}.png`,
    ].filter(Boolean);
    return candidates;
  };

  // LOGO (tenta múltiplos caminhos; mostra qual carregou)
  const [logoSrc, setLogoSrc] = useState(null);
  const [logoTried, setLogoTried] = useState([]);
  useEffect(() => {
    if (!selectedTeam) { setLogoSrc(null); setLogoTried([]); return; }
    const cands = typeof getTeamLogoCandidates === "function" ? getTeamLogoCandidates(selectedTeam) : [];
    setLogoTried(cands);
    if (!cands.length) { setLogoSrc(null); return; }
    let i = 0;
    const probe = new Image();
    const tryNext = () => {
      if (i >= cands.length) return;
      probe.src = cands[i];
    };
    probe.onload = () => setLogoSrc(cands[i]);
    probe.onerror = () => { i += 1; tryNext(); };
    tryNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam]);

  // contraste para legibilidade
  const contrastRatio = (hex1, hex2) => {
    const toRGB = (h) => {
      const s = h.replace("#","").padEnd(6,"0");
      const r = parseInt(s.slice(0,2),16)/255;
      const g = parseInt(s.slice(2,4),16)/255;
      const b = parseInt(s.slice(4,6),16)/255;
      const L = (c)=> (c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4));
      const Y = 0.2126*L(r)+0.7152*L(g)+0.0722*L(b);
      return Y;
    };
    const L1 = toRGB(hex1), L2 = toRGB(hex2);
    const [a,b] = L1 > L2 ? [L1,L2] : [L2,L1];
    return ((a + 0.05) / (b + 0.05)).toFixed(2);
  };

  // grid de todas as equipas para testar logos rapidamente
  const [allLogos, setAllLogos] = useState({});
  useEffect(() => {
    const run = async () => {
      const out = {};
      for (const t of teams) {
        const cands = typeof getTeamLogoCandidates === "function" ? getTeamLogoCandidates(t) : [];
        out[t.team_id] = { ok: false, used: null, tried: cands };
        if (!cands.length) continue;
        // testa em série
        for (const url of cands) {
          const ok = await probeImage(url);
          if (ok) { out[t.team_id] = { ok: true, used: url, tried: cands }; break; }
        }
      }
      setAllLogos(out);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Asset Test</h1>
        <div className="text-sm text-neutral-600">Season: {activeYear ?? "—"}</div>
      </div>

      {/* Seleção de equipa */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-neutral-600">Team</label>
        <select
          className="border rounded px-2 py-1"
          value={teamId ?? ""}
          onChange={(e)=>setTeamId(e.target.value)}
        >
          {(teams || []).map(t => (
            <option key={t.team_id} value={t.team_id}>
              {t.name || t.team_name || t.short_name || t.team_id}
            </option>
          ))}
        </select>
        {selectedTeam && (
          <span className="text-xs text-neutral-500">
            ID: <code>{selectedTeam.team_id}</code>
          </span>
        )}
      </div>

      {/* Secção: Logo + Cores + Motor */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* LOGO */}
        <div className="p-4 bg-white rounded-lg border">
          <div className="text-sm font-medium mb-2">Team Logo</div>
          <div className="h-28 w-full rounded-lg bg-neutral-50 ring-1 ring-black/5 flex items-center justify-center overflow-hidden">
            {logoSrc ? (
              <img src={logoSrc} alt={selectedTeam?.name} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-neutral-500">No logo loaded</span>
            )}
          </div>
          <div className="mt-2 text-xs text-neutral-600">
            <div className="font-medium">Tried paths:</div>
            <ul className="list-disc pl-4 space-y-1">
              {(logoTried || []).map((u, i) => (
                <li key={i} className={u === logoSrc ? "text-emerald-700" : ""}>{u}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* CORES */}
        <div className="p-4 bg-white rounded-lg border">
          <div className="text-sm font-medium mb-2">Team Colors (from team_brands)</div>
          <div className="grid grid-cols-2 gap-4">
            <Swatch label="Primary" color={primary} contrastWith="#FFFFFF" />
            <Swatch label="Secondary" color={secondary} contrastWith="#000000" />
          </div>
          <div className="text-xs text-neutral-600 mt-3">
            Contrast (primary vs secondary): <b>{contrastRatio(primary, secondary)}:1</b>
          </div>
        </div>

        {/* MOTOR */}
        <div className="p-4 bg-white rounded-lg border">
          <div className="text-sm font-medium mb-2">Power Unit</div>
          <div className="text-lg">{engineName || "—"}</div>
          <div className="text-xs text-neutral-500">Fonte: team_engines.json</div>
        </div>
      </section>

      {/* Secção: Pilotos (via contracts) */}
      <section className="p-4 bg-white rounded-lg border">
        <div className="text-sm font-medium mb-3">Drivers (from contracts.json)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {teamDrivers.length === 0 && (
            <div className="text-sm text-neutral-500">No drivers found for this team in {activeYear ?? "—"}.</div>
          )}
          {teamDrivers.map((d) => (
            <DriverCard key={d.name} name={d.name} resolvePortrait={resolvePortrait} />
          ))}
        </div>
      </section>

      {/* Secção: Scanner de todas as equipas (logos) */}
      <section className="p-4 bg-white rounded-lg border">
        <div className="text-sm font-medium mb-3">All Teams — Logo Status</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {(teams || []).map(t => {
            const status = allLogos[t.team_id] || {};
            return (
              <div key={t.team_id} className="border rounded-lg p-2 bg-neutral-50">
                <div className="text-xs font-medium truncate mb-2">{t.name || t.team_name || t.short_name}</div>
                <div className="h-12 bg-white rounded flex items-center justify-center overflow-hidden ring-1 ring-black/5">
                  {status.ok ? (
                    <img src={status.used} alt={t.name} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-neutral-500 px-1">not found</span>
                  )}
                </div>
                <div className={`mt-2 text-[10px] ${status.ok ? "text-emerald-700" : "text-rose-700"}`}>
                  {status.ok ? "OK" : "Missing"}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ===== componentes auxiliares ===== */

function Swatch({ label, color = "#777777", contrastWith = "#FFFFFF" }) {
  const ratio = useMemo(() => {
    const toRGB = (h) => {
      const s = String(h || "#000000").replace("#","").padEnd(6,"0");
      const r = parseInt(s.slice(0,2),16)/255;
      const g = parseInt(s.slice(2,4),16)/255;
      const b = parseInt(s.slice(4,6),16)/255;
      const L = (c)=> (c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4));
      const Y = 0.2126*L(r)+0.7152*L(g)+0.0722*L(b);
      return Y;
    };
    const L1 = toRGB(color), L2 = toRGB(contrastWith);
    const [a,b] = L1 > L2 ? [L1,L2] : [L2,L1];
    return ((a + 0.05) / (b + 0.05)).toFixed(2);
  }, [color, contrastWith]);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-xs text-neutral-600 border-b bg-neutral-50">{label}</div>
      <div className="h-20 flex items-center justify-center" style={{ background: color }}>
        <span className="text-xs font-medium" style={{ color: contrastWith }}>
          {color} • {ratio}:1
        </span>
      </div>
    </div>
  );
}

function DriverCard({ name, resolvePortrait }) {
  const [src, setSrc] = useState(null);
  const [tried, setTried] = useState([]);

  useEffect(() => {
    const cands = resolvePortrait(name);
    setTried(cands);
    if (!cands.length) return;
    let i = 0;
    const probe = new Image();
    const tryNext = () => {
      if (i >= cands.length) return;
      probe.src = cands[i];
    };
    probe.onload = () => setSrc(cands[i]);
    probe.onerror = () => { i += 1; tryNext(); };
    tryNext();
  }, [name, resolvePortrait]);

  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="h-28 rounded bg-neutral-50 ring-1 ring-black/5 flex items-center justify-center overflow-hidden mb-2">
        {src ? (
          <img src={src} alt={name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-xs text-neutral-500">no portrait</span>
        )}
      </div>
      <div className="text-sm font-medium">{name}</div>
      <details className="mt-1">
        <summary className="text-xs text-neutral-600 cursor-pointer">paths</summary>
        <ul className="pl-4 list-disc text-[11px] text-neutral-600">
          {tried.map((p, i) => (
            <li key={i} className={p === src ? "text-emerald-700" : ""}>{p}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/* ===== utilities ===== */

function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
