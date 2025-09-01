// src/pages/Staff.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/* ---------------- utils ---------------- */
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
const safeNum = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const fmtMoney = (n) => {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n||0)); }
  catch { return `${n}`; }
};
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2])-1, Number(m[3])) : new Date(v);
};

/* -------------- normalization -------------- */
function normalizeSkills(raw) {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    // array tipo [{key:"leadership", val:78}, ...] ou ["leadership","strategy"]
    const obj = {};
    raw.forEach((e) => {
      if (e && typeof e === "object") {
        const k = normId(e.key ?? e.name);
        obj[k] = safeNum(e.val ?? e.value ?? e.rating ?? 0);
      } else if (typeof e === "string") {
        obj[normId(e)] = 50; // default mid
      }
    });
    return obj;
  }
  if (typeof raw === "object") {
    // já é objeto {leadership: 75, strategy: 80, ...}
    const obj = {};
    Object.entries(raw).forEach(([k, v]) => (obj[normId(k)] = safeNum(v, 0)));
    return obj;
  }
  return {};
}

function normalizeStaffEntry(s, i, contractsIndex) {
  const id = s.staff_id ?? s.id ?? `S_${i + 1}`;
  const name = s.display_name ?? s.name ?? "Staff";
  const role = s.role ?? s.title ?? s.position ?? "Staff";
  const dept = (s.dept ?? s.department ?? s.category ?? guessDeptByRole(role)).toString();
  const skills = normalizeSkills(s.skills ?? s.attributes ?? s.stats);
  const overall =
    Object.keys(skills).length === 0
      ? safeNum(s.overall ?? s.rating ?? 0, 0)
      : Math.round(
          Object.values(skills).reduce((a, b) => a + safeNum(b, 0), 0) /
            Math.max(1, Object.values(skills).length)
        );

  // contract enrichment (optional)
  const c = contractsIndex[normId(id)] || null;
  const weekly = safeNum(s.salary_weekly ?? s.weekly ?? (s.salary_yearly ? s.salary_yearly/52 : c?.weekly), null);
  const yearly = safeNum(s.salary_yearly ?? s.yearly ?? (weekly ? weekly*52 : c?.yearly), null);
  const since = toDate(s.since ?? s.start_date ?? c?.since);
  const until = toDate(s.until ?? s.end_date ?? c?.until);

  return {
    staff_id: id,
    display_name: name,
    role,
    dept,
    nationality: s.country_name ?? s.nationality ?? "",
    age: safeNum(s.age, null),
    portrait_path: s.portrait_path ?? guessPortraitById(id),
    overall,
    skills,
    // contract-ish
    salary_weekly: weekly,
    salary_yearly: yearly,
    since,
    until,
    meta: s
  };
}

function guessDeptByRole(role) {
  const r = String(role || "").toLowerCase();
  if (r.includes("principal")) return "Leadership";
  if (r.includes("technical") || r.includes("chief engineer") || r.includes("engineer")) return "Technical";
  if (r.includes("aero") || r.includes("cfd") || r.includes("wind")) return "Aero";
  if (r.includes("pit")) return "Operations";
  if (r.includes("scout")) return "Scouting";
  if (r.includes("academy")) return "Academy";
  if (r.includes("mechanic")) return "Operations";
  return "Staff";
}

function guessPortraitById(id) {
  const n = normId(id);
  return `/portraits/staff/${n}.png`;
}

function buildContractsIndex(list) {
  const idx = {};
  if (!Array.isArray(list)) return idx;
  list.forEach((c) => {
    const sid = normId(c.staff_id ?? c.id ?? c.person_id ?? c.name);
    idx[sid] = {
      weekly: safeNum(c.weekly ?? c.salary_weekly ?? (c.yearly ? c.yearly/52 : null), null),
      yearly: safeNum(c.yearly ?? c.salary_yearly ?? (c.weekly ? c.weekly*52 : null), null),
      since: c.since ?? c.start ?? c.start_date ?? null,
      until: c.until ?? c.end ?? c.end_date ?? null
    };
  });
  return idx;
}

/* -------------------- component -------------------- */
export default function Staff() {
  const { gameState } = useGame();

  const [fallbackStaff, setFallbackStaff] = useState(null);
  const [fallbackContracts, setFallbackContracts] = useState(null);

  useEffect(() => {
    (async () => {
      const [s, c] = await Promise.all([
        tryFetchJSON(["/data/staff.json", "/data/team_staff.json", "/data/all_staff.json"]),
        tryFetchJSON(["/data/contracts_staff.json", "/data/staff_contracts.json"]),
      ]);
      setFallbackStaff(s);
      setFallbackContracts(c);
    })();
  }, []);

  const contractsIndex = useMemo(
    () => buildContractsIndex((gameState?.staff && gameState.staff.contracts) || fallbackContracts || []),
    [gameState?.staff, fallbackContracts]
  );

  const staffRaw = useMemo(() => {
    const fromState = Array.isArray(gameState?.staff?.list) ? gameState.staff.list
      : Array.isArray(gameState?.staff) ? gameState.staff
      : [];
    const fromFile = Array.isArray(fallbackStaff?.list) ? fallbackStaff.list
      : Array.isArray(fallbackStaff) ? fallbackStaff
      : [];
    return fromState.length ? fromState : fromFile;
  }, [gameState?.staff, fallbackStaff]);

  const staff = useMemo(
    () => staffRaw.map((s, i) => normalizeStaffEntry(s, i, contractsIndex)),
    [staffRaw, contractsIndex]
  );

  // team primary color (for accents)
  const teamPrimary = gameState?.team?.primary_color || gameState?.team?.color_primary || "#111827";

  /* --------------- filters & sorting --------------- */
  const DEPTS = useMemo(() => {
    const set = new Set(["All","Leadership","Technical","Aero","Operations","Scouting","Academy","Staff"]);
    staff.forEach(s => set.add(s.dept));
    return Array.from(set);
  }, [staff]);

  const [dept, setDept] = useState("All");
  const [q, setQ] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState("overall"); // overall|role|salary

  const filtered = useMemo(() => {
    let list = staff.filter(s => {
      if (dept !== "All" && String(s.dept) !== String(dept)) return false;
      if (minRating && (s.overall || 0) < minRating) return false;
      if (q) {
        const hay = `${s.display_name} ${s.role} ${s.dept} ${s.nationality}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    if (sort === "overall") list.sort((a, b) => (b.overall - a.overall) || a.display_name.localeCompare(b.display_name));
    if (sort === "role") list.sort((a, b) => a.role.localeCompare(b.role) || b.overall - a.overall);
    if (sort === "salary") list.sort((a, b) => (b.salary_yearly || 0) - (a.salary_yearly || 0));
    return list;
  }, [staff, dept, q, minRating, sort]);

  // key roles (prefer show-first if present)
  const KEY_ROLES = [
    "Team Principal","Technical Director","Chief Engineer","Chief Mechanic",
    "Pit Crew Chief","Head of Aero","Head of Scouting","Academy Director","Race Engineer"
  ];
  const keyStaff = filtered.filter(s => KEY_ROLES.some(kr => s.role.toLowerCase().includes(kr.toLowerCase())));
  const others = filtered.filter(s => !keyStaff.includes(s));

  return (
    <div className="p-4 md:p-6 space-y-4" style={{ ["--primary"]: teamPrimary }}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Staff</h1>
        <div className="text-sm text-muted-foreground">{staff.length} total</div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={dept} onChange={(e)=>setDept(e.target.value)} className="border rounded px-2 py-1">
              {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <div className="flex items-center gap-2">
              <label className="text-sm">Min rating</label>
              <input
                type="number"
                min={0}
                max={100}
                value={minRating}
                onChange={(e)=>setMinRating(Number(e.target.value))}
                className="border rounded px-2 py-1 w-20"
              />
            </div>

            <select value={sort} onChange={(e)=>setSort(e.target.value)} className="border rounded px-2 py-1">
              <option value="overall">Sort: Overall</option>
              <option value="role">Sort: Role</option>
              <option value="salary">Sort: Salary</option>
            </select>

            <input
              type="text"
              placeholder="Search name/role/nationality…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />

            <div className="flex-1" />

            <Button variant="outline" onClick={()=>{ setDept("All"); setQ(""); setMinRating(0); setSort("overall"); }}>
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Key roles */}
      {keyStaff.length > 0 && (
        <>
          <div className="text-sm text-muted-foreground">Key Roles</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {keyStaff.map((s) => <StaffCard key={s.staff_id} s={s} />)}
          </div>
        </>
      )}

      {/* Others */}
      <div className="text-sm text-muted-foreground">All Staff</div>
      <Card>
        <CardContent className="p-0">
          {others.length === 0 && keyStaff.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No staff found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Dept</th>
                  <th className="px-3 py-2">Nationality</th>
                  <th className="px-3 py-2 text-right">Overall</th>
                  <th className="px-3 py-2 text-right">Weekly</th>
                  <th className="px-3 py-2 text-right">Yearly</th>
                  <th className="px-3 py-2">Term</th>
                </tr>
              </thead>
              <tbody>
                {[...keyStaff, ...others].map((s) => (
                  <tr key={s.staff_id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar src={s.portrait_path} name={s.display_name} />
                        <div className="font-medium">{s.display_name}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{s.role}</td>
                    <td className="px-3 py-2">{s.dept}</td>
                    <td className="px-3 py-2">{s.nationality || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{s.overall || "—"}</td>
                    <td className="px-3 py-2 text-right">{s.salary_weekly != null ? fmtMoney(s.salary_weekly) : "—"}</td>
                    <td className="px-3 py-2 text-right">{s.salary_yearly != null ? fmtMoney(s.salary_yearly) : "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {s.since ? s.since.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "—"}
                      {" → "}
                      {s.until ? s.until.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------ UI bits ------------------ */
function StaffCard({ s }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Avatar src={s.portrait_path} name={s.display_name} />
          <div className="flex-1">
            <div className="font-medium leading-tight">{s.display_name}</div>
            <div className="text-xs text-muted-foreground">{s.role} • {s.dept}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold">{s.overall || "—"}</div>
            <div className="text-[11px] text-muted-foreground">Overall</div>
          </div>
        </div>

        {/* Skills grid */}
        {s.skills && Object.keys(s.skills).length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {Object.entries(s.skills)
              .sort((a,b)=>b[1]-a[1])
              .slice(0,6)
              .map(([k,v]) => (
              <div key={k} className="rounded-lg border p-2">
                <div className="text-[11px] text-muted-foreground">{titleCase(k.replace(/_/g," "))}</div>
                <div className="text-sm font-medium">{v}</div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Salary quick line */}
        {(s.salary_weekly != null || s.salary_yearly != null) ? (
          <div className="mt-3 text-xs text-muted-foreground">
            {s.salary_weekly != null ? `Weekly: ${fmtMoney(s.salary_weekly)}` : ""}
            {s.salary_yearly != null ? ` • Yearly: ${fmtMoney(s.salary_yearly)}` : ""}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Avatar({ src, name }) {
  return (
    <div className="h-10 w-10 rounded-lg overflow-hidden bg-muted/40 flex items-center justify-center ring-1 ring-black/5">
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={(e)=>{ e.currentTarget.style.display = "none"; }}
        />
      ) : (
        <span className="text-xs px-1 text-muted-foreground">{(name||"").split(" ").map(x=>x[0]).join("").slice(0,2)}</span>
      )}
    </div>
  );
}
