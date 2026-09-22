import React, { useMemo, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { activeDriverContracts } from "@/domain/driverContracts";
import { activeStaffContracts } from "@/domain/liveContracts";

/* ----------------- utils ----------------- */
const fmtMoney = (n) => {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(n || 0));
  } catch {
    return `${n}`;
  }
};
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date(v);
};
const monthKey = (d) =>
  `${d.getUTCFullYear?.() ?? d.getFullYear()}-${String((d.getUTCMonth?.() ?? d.getMonth()) + 1).padStart(2, "0")}`;
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const unbox = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if (v.result !== undefined && v.result !== null && v.result !== "") return v.result;
    if (v.value !== undefined && v.value !== null && v.value !== "") return v.value;
  }
  return v;
};
const N = (v, def = 0) => {
  const n = Number(unbox(v));
  return Number.isFinite(n) ? n : def;
};
const pick = (obj, keys, fb) => {
  for (const k of keys) {
    const v = unbox(obj ? obj[k] : undefined);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};
const getTeamId = (t) => String(pick(t, ["team_id", "id", "name", "team_name", "short_name"], ""));

function normalizeSponsorTier(value) {
  const t = String(value || "").toLowerCase();
  return /main|major|title/.test(t) ? "main" : "secondary";
}
function sponsorObjectiveInfo(sp) {
  const raw = String(pick(sp, ["objective_type"], "") || "").toLowerCase().replace(/\s+/g,"_");
  const penalties = String(pick(sp, ["penalties"], "") || "").toLowerCase();
  let type = raw;
  let target = Number(pick(sp, ["objective_target","target_value"], NaN));

  if (!type || type === "performance") {
    if (/no wins?|win/.test(penalties)) { type = "wins"; target = Number.isFinite(target) ? target : 1; }
    else if (/no podium|podium/.test(penalties)) { type = "podiums"; target = Number.isFinite(target) ? target : 1; }
    else if (/outside top\s*5/.test(penalties)) { type = "constructor_position"; target = 5; }
    else if (/outside top\s*6/.test(penalties)) { type = "constructor_position"; target = 6; }
    else if (/no points?|points?/.test(penalties)) { type = "points"; target = Number.isFinite(target) ? target : 1; }
    else { type = "points"; target = Number.isFinite(target) ? target : 5; }
  }
  if (type === "top_6" || type === "top6") { type = "constructor_position"; target = 6; }
  if (type === "top_10" || type === "top10") { type = "constructor_position"; target = 10; }
  if (type === "wins") target = Number.isFinite(target) ? target : 1;
  if (type === "podiums") target = Number.isFinite(target) ? target : 2;
  if (type === "points") target = Number.isFinite(target) ? target : 10;
  if (type === "qualifying") target = Number.isFinite(target) ? target : 3;
  if (type === "branding") target = 1;

  const label = {
    wins: `Win ${target} Grand Prix`,
    podiums: `Achieve ${target} podium${target===1?"":"s"}`,
    points: `Score ${target} championship points`,
    constructor_position: `Finish P${target} or better in Constructors`,
    qualifying: `Achieve ${target} top-10 qualifying result${target===1?"":"s"}`,
    branding: "Maintain sponsor visibility and relationship",
  }[type] || "Maintain sponsor relationship";

  return { type:type || "branding", target:Number(target || 1), label };
}

/* ------------- derive from ledger -------------- */
function buildSnapshot(gameState) {
  const activeYear = Number(gameState?.activeYear) || 0;
  const ledger = Array.isArray(gameState?.financeLog) ? gameState.financeLog : [];

  const entries = ledger
    .map((e) => ({ ...e, date: toDate(e.dateISO || e.date) }))
    .filter((e) => e.date && (e.date.getUTCFullYear?.() ?? e.date.getFullYear()) === activeYear);

  const income = entries
    .filter((e) => String(e.type).toLowerCase() === "income")
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // despesas sempre em valor absoluto para contabilidade de época
  const expense = entries
    .filter((e) => String(e.type).toLowerCase() === "expense")
    .reduce((s, e) => s + Math.abs(Number(e.amount) || 0), 0);

  const seasonNet = income - expense;

  const cashflowMap = new Map();
  for (const e of entries) {
    const mk = monthKey(e.date);
    const row = cashflowMap.get(mk) || { month: mk, income: 0, expense: 0, net: 0 };
    const amt = Number(e.amount) || 0;
    if (String(e.type).toLowerCase() === "income") row.income += amt;
    else row.expense += Math.abs(amt);
    row.net = row.income - row.expense;
    cashflowMap.set(mk, row);
  }
  const cashflow = Array.from(cashflowMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  const storedBudget = Number(gameState?.team?.budget ?? gameState?.finances?.budget ?? 0);
  const storedBalance = Number(gameState?.finances?.balance);
  const balance = Number.isFinite(storedBalance) ? storedBalance : storedBudget;

  const fin = {
    ...(gameState?.finances || {}),
    budget: storedBudget,
    balance,
    weekly_burn: Number(gameState?.finances?.weekly_burn || 0),
    season_spend: expense || Number(gameState?.finances?.season_spend || 0),
    season_income: income || Number(gameState?.finances?.season_income || 0),
    season_net: seasonNet,
  };

  return {
    fin,
    cashflow,
    transactions: entries
      .slice()
      .sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0)),
  };
}

/* ------------- derive sponsors/salaries -------------- */
function deriveSponsors(gameState) {
  const Y = Number(gameState?.activeYear) || 0;
  const teamId = getTeamId(gameState?.team || {});
  const todayISO = String(gameState?.currentDateISO || `${Y}-01-01`).slice(0, 10);
  const today = toDate(todayISO);

  const list = (gameState?.sponsorsContracts || []).filter(
    (r) => String(pick(r, ["team_id", "team", "constructor", "id"], "")) === String(teamId)
  );

  return (list || []).map((sp) => {
    const name = String(pick(sp, ["sponsor_name", "name"], "Sponsor"));
    const sid = String(pick(sp, ["sponsor_id", "id", "name"], name));

    // período (preferir campos por-ano; cair para datas)
    const startYear = Number(
      pick(sp, ["start_year", "year", "since_year"], Y)
    );
    const endYear = Number(pick(sp, ["end_year", "until_year"], Y));
    const startISO =
      String(pick(sp, ["start_date"], `${startYear}-01-02`)).slice(0, 10); // regra: upfront a 02/01
    const endISO = String(pick(sp, ["end_date"], `${endYear}-12-31`)).slice(0, 10);

    const start = toDate(startISO);
    const end = toDate(endISO);

    const annual_income = N(pick(sp, ["annual_income", "anual_income", "value_year"], 0), 0);
    const monthly_fee = N(pick(sp, ["monthly_fee", "monthly", "per_month"], NaN), NaN) || annual_income / 12;
    const cash_upfront = N(pick(sp, ["cash_upfront", "upfront", "signing_fee"], 0), 0);

    const bonus_win = N(pick(sp, ["bonus_win", "win_bonus"], 0), 0);
    const bonus_podium = N(pick(sp, ["bonus_podium", "podium_bonus"], 0), 0);
    const bonus_championship = N(pick(sp, ["bonus_championship", "championship_bonus"], 0), 0);

    let status = "pending";
    if (today >= start && today <= end) status = "active";
    else if (today > end) status = "expired";

    const sType = normalizeSponsorTier(pick(sp, ["type", "tier", "category", "sponsor_reputation"], "secondary"));
    const objective = sponsorObjectiveInfo(sp);

    return {
      sponsor_id: sid,
      name,
      type: sType,
      startYear,
      endYear,
      startISO,
      endISO,
      monthly_fee: Math.round(monthly_fee || 0),
      annual_income: Math.round(annual_income || 0),
      cash_upfront: Math.round(cash_upfront || 0),
      bonus_win,
      bonus_podium,
      bonus_championship,
      status: String(pick(sp, ["status"], status)).toLowerCase(),
      objective_type: objective.type,
      objective_target: objective.target,
      objective_label: objective.label,
      satisfaction: Math.max(0,Math.min(100,N(pick(sp, ["satisfaction"], 70),70))),
      relationship_note: String(pick(sp, ["relationship_note"], "")),
    };
  });
}

function deriveSalaries(gameState) {
  const teamId = getTeamId(gameState?.team || {});

  const driversRaw = activeDriverContracts(gameState,{teamId});
  const staffRaw = activeStaffContracts(gameState,{teamId});

  const mapRec = (c, kind) => {
    const yearly =
      N(pick(c, ["salary_year", "salary", "annual_salary", "yearly", "value_year"], 0), 0) || 0;
    const weekly = yearly / 52;
    const monthly = yearly / 12;
    const name =
      kind === "driver" ? pick(c, ["driver_name", "name"], "Driver") : pick(c, ["name", "staff_name", "person_name"], "Staff");
    const role = kind === "driver" ? "Driver" : pick(c, ["role", "position", "job"], "Staff");
    const id = String(
      pick(c, kind === "driver" ? ["driver_id", "person_id", "id"] : ["staff_id", "person_id", "id"], name)
    );
    return {
      id,
      kind,
      name,
      role,
      weekly: Math.round(weekly),
      monthly: Math.round(monthly),
      yearly: Math.round(yearly),
    };
  };

  return [...driversRaw.map((c) => mapRec(c, "driver")), ...staffRaw.map((c) => mapRec(c, "staff"))];
}

/* ---------------- component --------------- */
export default function Finances() {
  const { gameState } = useGame();

  const { fin, cashflow, transactions } = useMemo(() => buildSnapshot(gameState), [gameState]);

  const sponsors = useMemo(() => deriveSponsors(gameState), [gameState]);
  const salaries = useMemo(() => deriveSalaries(gameState), [gameState]);

  const [tab, setTab] = useState("overview");

  return (
    <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">Finances</h1>
        <div className="text-sm text-slate-400">
          Balance: <span className="font-medium text-slate-100">{fmtMoney(fin.balance || fin.budget)}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {[
          ["overview", "Overview"],
          ["cashflow", "Cashflow"],
          ["sponsors", "Sponsors"],
          ["salaries", "Salaries"],
          ["transactions", "Transactions"],
        ].map(([k, label]) => (
          <Button key={k} variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)}>
            {label}
          </Button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <OverviewTab fin={fin} cashflow={cashflow} sponsors={sponsors} salaries={salaries} />
      )}
      {tab === "cashflow" && <CashflowTab cashflow={cashflow} />}
      {tab === "sponsors" && <SponsorsTab sponsors={sponsors} />}
      {tab === "salaries" && <SalariesTab salaries={salaries} />}
      {tab === "transactions" && <TransactionsTab transactions={transactions} />}
    </div>
  );
}

/* ---------------- tabs ------------------- */
function OverviewTab({ fin, cashflow, sponsors, salaries }) {
  const last3 = (cashflow || []).slice(-3);
  const lastNet = last3.reduce((s, m) => s + (m.net || 0), 0);

  const sponsorEstYear = sponsors.reduce(
    (s, sp) => s + (sp.monthly_fee || 0) * 12 + (sp.cash_upfront || 0),
    0
  );
  const salaryYear = salaries.reduce((s, r) => s + (r.yearly || 0), 0);
  const driverSalaryYear = salaries.filter((r)=>r.kind==="driver").reduce((s,r)=>s+(r.yearly||0),0);
  const staffSalaryYear = salaries.filter((r)=>r.kind==="staff").reduce((s,r)=>s+(r.yearly||0),0);
  const activeSponsors = sponsors.filter((s)=>s.status==="active").length;

  const monthlyBurn =
    salaries.reduce((s, r) => s + (r.monthly || 0), 0) -
    sponsors.reduce((s, r) => s + (r.monthly_fee || 0), 0);
  const runwayMonths =
    monthlyBurn > 0 ? Math.floor((fin.balance || fin.budget || 0) / monthlyBurn) : null;

  return (
    <>
      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <Stat title="Budget / Balance" value={fmtMoney(fin.budget || fin.balance)} />
        <Stat title="Season Net" value={fmtMoney((fin.season_income - fin.season_spend) || lastNet)} />
        <Stat title="Sponsor value / year" value={fmtMoney(sponsorEstYear)} />
        <Stat title="Annual wage bill" value={fmtMoney(salaryYear)} />
        <Stat title="Weekly Burn" value={fmtMoney((monthlyBurn || 0) / 4)} />
        <Stat title="Runway" value={runwayMonths != null ? `${runwayMonths} months` : "—"} />
      </div>

      {/* Mini sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
          <CardContent className="p-4">
            <div className="text-sm text-slate-400 mb-1">Latest Cashflow</div>
            {last3.length === 0 ? (
              <div className="text-sm text-slate-400">No cashflow data.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#171a23] text-slate-300">
                  <tr className="text-left">
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2 text-right">Income</th>
                    <th className="px-3 py-2 text-right">Expense</th>
                    <th className="px-3 py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {last3.map((m, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{m.month}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(m.income)}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(m.expense)}</td>
                      <td className={`px-3 py-2 text-right ${m.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {fmtMoney(m.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
          <CardContent className="p-4">
            <div className="text-sm text-slate-400 mb-1">This Season (est.)</div>
            <div className="grid grid-cols-2 gap-2">
              <Mini stat="Active sponsors" val={activeSponsors} />
              <Mini stat="Sponsor (est.)" val={fmtMoney(sponsorEstYear)} />
              <Mini stat="Driver wages" val={fmtMoney(driverSalaryYear)} />
              <Mini stat="Staff wages" val={fmtMoney(staffSalaryYear)} />
              <Mini stat="Spend (reported)" val={fmtMoney(fin.season_spend)} />
              <Mini stat="Income (reported)" val={fmtMoney(fin.season_income)} />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function CashflowTab({ cashflow }) {
  if (!cashflow.length) {
    return (
      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
        <CardContent className="p-4 text-sm text-slate-400">No cashflow data.</CardContent>
      </Card>
    );
  }
  const maxAbs = Math.max(1, ...cashflow.map((m) => Math.abs(m.net)));
  return (
    <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
      <CardContent className="p-4">
        <table className="w-full text-sm">
          <thead className="bg-[#171a23] text-slate-300">
            <tr className="text-left">
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2 text-right">Income</th>
              <th className="px-3 py-2 text-right">Expense</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2">Bar</th>
            </tr>
          </thead>
          <tbody>
            {cashflow.map((m, i) => {
              const w = Math.round((Math.abs(m.net) / maxAbs) * 100);
              return (
                <tr key={i} className="border-t border-white/10">
                  <td className="px-3 py-2">{m.month}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(m.income)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(m.expense)}</td>
                  <td className={`px-3 py-2 text-right ${m.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {fmtMoney(m.net)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full bg-white/10 rounded">
                      <div
                        className="h-2 rounded"
                        style={{
                          width: `${w}%`,
                          background: m.net >= 0 ? "var(--green, #16a34a)" : "var(--red, #dc2626)",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function SponsorsTab({ sponsors }) {
  const setGameState = useGame((s) => s.setGameState);
  const gameState = useGame((s) => s.gameState);
  const Y = Number(gameState?.activeYear) || 0;
  const teamId = getTeamId(gameState?.team || {});
  const todayISO = String(gameState?.currentDateISO || `${Y}-01-01`).slice(0, 10);

  const [status, setStatus] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [negotiating, setNegotiating] = useState(null);
  const [offerAnnual, setOfferAnnual] = useState(0);
  const [offerUpfront, setOfferUpfront] = useState(0);
  const [offerWinBonus, setOfferWinBonus] = useState(0);
  const [negotiationRound, setNegotiationRound] = useState(0);
  const [negotiationNote, setNegotiationNote] = useState("");

  const filtered = useMemo(
    () => sponsors.filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      return true;
    }),
    [sponsors, status, typeFilter]
  );

  const totalMonthly = filtered.reduce((s, r) => s + (r.monthly_fee || 0), 0);
  const totalUpfront = filtered.reduce((s, r) => s + (r.cash_upfront || 0), 0);

  // slots: 1 main, 3 secondary (ativos no ano)
  const activeMains = sponsors.filter((s) => s.type === "main" && !["expired","terminated"].includes(s.status));
  const activeSeconds = sponsors.filter((s) => s.type === "secondary" && !["expired","terminated"].includes(s.status));
  const canAddMain = activeMains.length < 1;
  const canAddSecondary = activeSeconds.length < 3;

  const commercialProfile = useMemo(() => {
    const teamRows = Array.isArray(gameState?.standings?.teams) ? gameState.standings.teams : [];
    const sorted = [...teamRows].sort((a,b) => Number(b?.points || 0) - Number(a?.points || 0));
    const pos = sorted.findIndex((row) => String(pick(row, ["team_id","constructor_id","id"], "")) === String(teamId));
    const position = pos >= 0 ? pos + 1 : null;
    const totalTeams = Math.max(1, sorted.length || (gameState?.teams || []).length || 1);

    const results = Array.isArray(gameState?.results) ? gameState.results : [];
    let wins = 0, podiums = 0;
    for (const event of results) {
      for (const row of event?.classification || []) {
        if (String(row?.team_id || "") !== String(teamId)) continue;
        const p = Number(row?.position);
        if (p === 1) wins += 1;
        if (p >= 1 && p <= 3) podiums += 1;
      }
    }

    const brand = (gameState?.teamBrands || []).find((row) =>
      String(pick(row, ["team_id","team","constructor"], "")) === String(teamId)
    );
    const expectation = String(pick(brand, ["board_expectation"], "")).toLowerCase();
    let prestige = 0.42;
    if (/championship|title/.test(expectation)) prestige = 0.78;
    else if (/race_wins|wins/.test(expectation)) prestige = 0.70;
    else if (/podium/.test(expectation)) prestige = 0.60;
    else if (/points|midfield|top/.test(expectation)) prestige = 0.48;
    else if (/survival|backmarker/.test(expectation)) prestige = 0.32;

    const standingScore = position
      ? Math.max(0.2, 1 - (position - 1) / Math.max(1, totalTeams - 1))
      : 0.45;
    const boardRep = Number(gameState?.board?.reputation ?? 0.5);
    const resultsScore = Math.min(1, 0.35 + wins * 0.18 + podiums * 0.06);
    const score = Math.max(0, Math.min(1,
      prestige * 0.40 +
      standingScore * 0.25 +
      boardRep * 0.20 +
      resultsScore * 0.15
    ));

    return { score, position, totalTeams, wins, podiums, boardRep };
  }, [gameState?.standings, gameState?.results, gameState?.teams, gameState?.teamBrands, gameState?.board, teamId]);

  const commercialScore = Math.round(
    Number.isFinite(Number(gameState?.commercialScore))
      ? Number(gameState.commercialScore)
      : commercialProfile.score * 100
  );

  const sponsorEligibility = useCallback((sp) => {
    const objective = String(pick(sp, ["objective_type"], "") || "").toLowerCase();
    const annual = N(pick(sp, ["annual_income","anual_income","value_year"], 0), 0);
    const baseThreshold = {
      wins: 0.68,
      podiums: 0.58,
      top_6: 0.50,
      top_10: 0.38,
      qualifying: 0.30,
    }[objective] ?? 0.25;
    const valuePremium = annual >= 3_500_000 ? 0.05 : annual >= 2_500_000 ? 0.025 : 0;
    const required = Math.min(0.85, baseThreshold + valuePremium);
    const relationshipScore = commercialScore / 100;
    const eligible = relationshipScore >= required;
    const objectiveLabel = objective ? objective.replace(/_/g, " ") : "brand fit";
    return {
      eligible,
      required,
      score: relationshipScore,
      text: eligible
        ? `Eligible · ${objectiveLabel} requirement met`
        : `Needs Commercial Score ${Math.round(required*100)} for ${objectiveLabel} (current ${commercialScore})`,
    };
  }, [commercialScore]);

  const loadCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/data/core_sponsors_catalog.json", { cache: "no-store" });
      const json = await res.json();
      const pool = Array.isArray(json) ? json : json?.list || [];

      // ativos neste ano
      const activeNow = pool.filter((sp) => {
        const from = Number(pick(sp, ["start_year", "from_year"], -Infinity));
        const to = Number(pick(sp, ["end_year", "to_year"], Infinity));
        return Y >= from && Y <= (Number.isFinite(to) ? to : Infinity);
      });

      // excluir já assinados (por sponsor_id)
      const signed = new Set(sponsors.map((s) => String(s.sponsor_id)));
      const avail = activeNow.filter((sp) => !signed.has(String(pick(sp, ["sponsor_id", "id", "name"]))));

      // Keep ineligible sponsors visible so the player can see what is required.
      const filteredBySlots = avail.filter((sp) => {
        const t = normalizeSponsorTier(pick(sp, ["type", "tier", "category", "sponsor_reputation"], "secondary"));
        return t === "main" ? canAddMain : canAddSecondary;
      });

      setCatalog(filteredBySlots);
    } catch (e) {
      console.warn("load catalog failed:", e);
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  }, [Y, sponsors, canAddMain, canAddSecondary]);

  const finalizeSponsor = useCallback(
    (sp, terms = {}) => {
      const type = normalizeSponsorTier(pick(sp, ["type", "tier", "category", "sponsor_reputation"], "secondary"));
      if (type === "main" && !canAddMain) return;
      if (type !== "main" && !canAddSecondary) return;
      const eligibility = sponsorEligibility(sp);
      if (!eligibility.eligible) {
        alert(`Sponsor requirements not met. ${eligibility.text}`);
        return;
      }

      const sponsor_id = String(pick(sp, ["sponsor_id", "id", "name"]));
      const sponsor_name = String(pick(sp, ["sponsor_name", "name"], sponsor_id));

      // construir contrato para sponsors_contracts
      const monthly_fee =
        N(pick(sp, ["monthly_fee", "monthly", "per_month"], NaN), NaN) ||
        N(pick(sp, ["annual_income", "anual_income", "value_year"], 0), 0) / 12;
      const annual_income = N(terms.annual_income, N(pick(sp, ["annual_income", "anual_income", "value_year"], Math.round((monthly_fee || 0) * 12)), 0));
      const cash_upfront = N(terms.cash_upfront, N(pick(sp, ["cash_upfront", "upfront", "signing_fee"], 0), 0));

      const bonus_win = N(terms.bonus_win, N(pick(sp, ["bonus_win", "win_bonus"], 0), 0));
      const bonus_podium = N(pick(sp, ["bonus_podium", "podium_bonus"], 0), 0);
      const bonus_championship = N(pick(sp, ["bonus_championship", "championship_bonus"], 0), 0);

      const objective = sponsorObjectiveInfo(sp);
      const newContract = {
        sponsor_id,
        sponsor_name,
        team_id: teamId,
        type,
        start_year: Y,
        end_year: Y,
        start_date: todayISO,
        end_date: `${Y}-12-31`,
        monthly_fee: Math.round((annual_income || monthly_fee * 12 || 0) / 12),
        annual_income: Math.round(annual_income || 0),
        cash_upfront: Math.round(cash_upfront || 0),
        bonus_win,
        bonus_podium,
        bonus_championship,
        objective_type: objective.type,
        objective_target: objective.target,
        satisfaction: 70,
        relationship_note: `New partnership · objective: ${objective.label}`,
        status: "active",
      };

      const sponsorsContracts = Array.isArray(gameState?.sponsorsContracts)
        ? [...gameState.sponsorsContracts, newContract]
        : [newContract];

      const upfront = Number(newContract.cash_upfront || 0);
      const tx = {
        id: `tx_sp_upfront_${Date.now()}`,
        dateISO: todayISO,
        type: "income",
        category: "Sponsor Upfront",
        desc: sponsor_name,
        amount: upfront,
        sig: `sponsor-upfront:${teamId}:${Y}:${sponsor_id}`,
      };
      const financeLog = upfront
        ? [...(Array.isArray(gameState?.financeLog) ? gameState.financeLog : []), tx]
        : (Array.isArray(gameState?.financeLog) ? gameState.financeLog : []);

      const currentBudget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);
      const nextBudget = currentBudget + upfront;
      const team = { ...(gameState?.team || {}), budget: nextBudget };
      const finances = {
        ...(gameState?.finances || {}),
        budget: nextBudget,
        balance: Number(gameState?.finances?.balance ?? currentBudget) + upfront,
        season_income: Number(gameState?.finances?.season_income || 0) + upfront,
      };

      setGameState({ sponsorsContracts, financeLog, team, finances });
      setCatalog((prev) => Array.isArray(prev)
        ? prev.filter((item) => String(pick(item, ["sponsor_id", "id", "name"])) !== sponsor_id)
        : prev
      );

      setGameState({
        inbox:[
          {
            id:`sponsor_signed_${Date.now()}`,
            date:todayISO,
            from:"Commercial Director",
            type:"FINANCE",
            tag:"Sponsors",
            subject:`Sponsor agreement signed — ${sponsor_name}`,
            body:`${sponsor_name} accepted the negotiated package. Annual value: ${fmtMoney(annual_income)} · Upfront: ${fmtMoney(cash_upfront)} · Win bonus: ${fmtMoney(bonus_win)}.`,
            unread:true,
          },
          ...(gameState?.inbox||[]),
        ],
      });
      setNegotiating(null);
      setNegotiationNote("");
    },
    [Y, teamId, todayISO, setGameState, gameState, canAddMain, canAddSecondary, sponsorEligibility]
  );

  const startSponsorNegotiation = useCallback((sp) => {
    const annual=N(pick(sp,["annual_income","anual_income","value_year"],0),0);
    const upfront=N(pick(sp,["cash_upfront","upfront","signing_fee"],0),0);
    const win=N(pick(sp,["bonus_win","win_bonus"],0),0);
    setNegotiating(sp);
    setOfferAnnual(Math.round(annual));
    setOfferUpfront(Math.round(upfront));
    setOfferWinBonus(Math.round(win));
    setNegotiationRound(1);
    setNegotiationNote("Opening terms from the sponsor. You can ask for more, but aggressive demands reduce acceptance.");
  },[]);

  const submitSponsorOffer = useCallback(() => {
    if(!negotiating)return;
    const eligibility=sponsorEligibility(negotiating);
    if(!eligibility.eligible)return;

    const baseAnnual=Math.max(1,N(pick(negotiating,["annual_income","anual_income","value_year"],0),0));
    const baseUpfront=Math.max(1,N(pick(negotiating,["cash_upfront","upfront","signing_fee"],0),0)||baseAnnual*0.08);
    const baseWin=Math.max(1,N(pick(negotiating,["bonus_win","win_bonus"],0),0)||baseAnnual*0.03);

    const annualRatio=Number(offerAnnual||0)/baseAnnual;
    const upfrontRatio=Number(offerUpfront||0)/baseUpfront;
    const winRatio=Number(offerWinBonus||0)/baseWin;
    const demandPressure=Math.max(0,annualRatio-1)*0.55+Math.max(0,upfrontRatio-1)*0.30+Math.max(0,winRatio-1)*0.15;
    const relationship=(commercialScore/100);
    const roundPenalty=Math.max(0,negotiationRound-1)*0.06;
    const acceptance=Math.max(0.05,Math.min(0.95,0.68+relationship*0.25-demandPressure-roundPenalty));

    if(Math.random()<acceptance){
      finalizeSponsor(negotiating,{
        annual_income:Math.round(Number(offerAnnual||0)),
        cash_upfront:Math.round(Number(offerUpfront||0)),
        bonus_win:Math.round(Number(offerWinBonus||0)),
      });
      return;
    }

    const counterAnnual=Math.round((baseAnnual+Number(offerAnnual||0))*0.5/50000)*50000;
    const counterUpfront=Math.round((baseUpfront+Number(offerUpfront||0))*0.5/25000)*25000;
    const counterWin=Math.round((baseWin+Number(offerWinBonus||0))*0.5/10000)*10000;
    setOfferAnnual(counterAnnual);
    setOfferUpfront(counterUpfront);
    setOfferWinBonus(counterWin);
    setNegotiationRound((r)=>r+1);
    setNegotiationNote(
      negotiationRound>=3
        ? "The sponsor is close to walking away. This is effectively their final counter-offer."
        : `Counter-offer received. Estimated acceptance of your last proposal was ${Math.round(acceptance*100)}%.`
    );
  },[negotiating,offerAnnual,offerUpfront,offerWinBonus,commercialScore,negotiationRound,sponsorEligibility,finalizeSponsor]);

  return (
    <>
      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)} className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-2 py-1">
              <option value="all">All types</option>
              <option value="main">Main</option>
              <option value="secondary">Secondary</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-2 py-1"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="pending">Pending</option>
              <option value="terminated">Terminated</option>
            </select>
            <div className="text-sm text-slate-400">
              {filtered.length} sponsors • Main {activeMains.length}/1 • Secondary {activeSeconds.length}/3 • Commercial Score <strong>{commercialScore}/100</strong>
            </div>
          </div>
          <div className="flex-1" />
          <Button variant="darkOutline" onClick={loadCatalog} disabled={loading}>
            {loading ? "Loading…" : "Find sponsors"}
          </Button>
        </CardContent>
      </Card>

      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">No sponsors.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#171a23] text-slate-300">
                <tr className="text-left">
                  <th className="px-3 py-2">Sponsor</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Monthly</th>
                  <th className="px-3 py-2 text-right">Annual (info)</th>
                  <th className="px-3 py-2 text-right">Upfront</th>
                  <th className="px-3 py-2">Objective</th>
                  <th className="px-3 py-2 text-right">Satisfaction</th>
                  <th className="px-3 py-2 text-right">Bonus (W / P / Ch)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={`${s.sponsor_id}_${s.startYear}`} className="border-t border-white/10">
                    <td className="px-3 py-2">{s.name}</td>
                    <td className="px-3 py-2">{titleCase(s.type)}</td>
                    <td className="px-3 py-2">{titleCase(s.status)}</td>
                    <td className="px-3 py-2">
                      {s.startISO} → {s.endISO}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.monthly_fee)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.annual_income)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.cash_upfront)}</td>
                    <td className="px-3 py-2 max-w-[240px]"><div>{s.objective_label}</div>{s.relationship_note&&<div className="text-xs text-slate-400 mt-1">{s.relationship_note}</div>}</td>
                    <td className="px-3 py-2 text-right"><span className={s.satisfaction<35?"text-rose-300":s.satisfaction<60?"text-amber-300":"text-emerald-300"}>{Math.round(s.satisfaction)}%</span></td>
                    <td className="px-3 py-2 text-right">
                      {fmtMoney(s.bonus_win)} / {fmtMoney(s.bonus_podium)} / {fmtMoney(s.bonus_championship)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {negotiating && (
        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">Sponsor Negotiation — {String(pick(negotiating,["sponsor_name","name"],"Sponsor"))}</div>
              <div className="text-xs text-slate-400">Round {negotiationRound} · Commercial Score {commercialScore}/100</div>
            </div>
            <Button size="sm" variant="darkOutline" onClick={()=>{setNegotiating(null);setNegotiationNote("");}}>Walk Away</Button>
          </div>
          <p className="text-sm text-slate-400">{negotiationNote}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">Annual value
              <input type="number" min="0" step="50000" value={offerAnnual} onChange={(e)=>setOfferAnnual(Number(e.target.value))} className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full"/>
            </label>
            <label className="text-sm">Upfront
              <input type="number" min="0" step="25000" value={offerUpfront} onChange={(e)=>setOfferUpfront(Number(e.target.value))} className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full"/>
            </label>
            <label className="text-sm">Win bonus
              <input type="number" min="0" step="10000" value={offerWinBonus} onChange={(e)=>setOfferWinBonus(Number(e.target.value))} className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full"/>
            </label>
          </div>
          <div className="flex gap-2">
            <Button onClick={submitSponsorOffer}>Submit Offer</Button>
            <Button variant="darkOutline" onClick={()=>startSponsorNegotiation(negotiating)}>Reset to Sponsor Terms</Button>
          </div>
        </CardContent></Card>
      )}

      {catalog && (
        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
          <CardContent className="p-0">
            {catalog.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">
                No available sponsors (check slot limits or year activity).
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#171a23] text-slate-300">
                  <tr className="text-left">
                    <th className="px-3 py-2">Sponsor</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Active (years)</th>
                    <th className="px-3 py-2 text-right">Monthly</th>
                    <th className="px-3 py-2 text-right">Annual (info)</th>
                    <th className="px-3 py-2 text-right">Upfront</th>
                    <th className="px-3 py-2 text-right">Bonus (W / P / Ch)</th>
                    <th className="px-3 py-2">Requirements</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((sp) => {
                    const t = normalizeSponsorTier(pick(sp, ["type", "tier", "category", "sponsor_reputation"], "secondary"));
                    const slotBlocked =
                      (t === "main" && !canAddMain) || (t !== "main" && !canAddSecondary);
                    const eligibility = sponsorEligibility(sp);
                    const block = slotBlocked || !eligibility.eligible;
                    const monthly =
                      N(pick(sp, ["monthly_fee", "monthly", "per_month"], NaN), NaN) ||
                      N(pick(sp, ["annual_income", "anual_income", "value_year"], 0), 0) / 12;
                    const annual = N(pick(sp, ["annual_income", "anual_income", "value_year"], Math.round((monthly || 0) * 12)), 0);
                    const upfront = N(pick(sp, ["cash_upfront", "upfront", "signing_fee"], 0), 0);
                    const bw = N(pick(sp, ["bonus_win", "win_bonus"], 0), 0);
                    const bp = N(pick(sp, ["bonus_podium", "podium_bonus"], 0), 0);
                    const bc = N(pick(sp, ["bonus_championship", "championship_bonus"], 0), 0);
                    const from = pick(sp, ["start_year", "from_year"], "—");
                    const to = pick(sp, ["end_year", "to_year"], "—");

                    return (
                      <tr key={String(pick(sp, ["sponsor_id", "id", "name"]))} className="border-t border-white/10">
                        <td className="px-3 py-2">{String(pick(sp, ["sponsor_name", "name"]))}</td>
                        <td className="px-3 py-2">{titleCase(t)}</td>
                        <td className="px-3 py-2">
                          {from}–{to}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtMoney(monthly)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(annual)}</td>
                        <td className="px-3 py-2 text-right">{fmtMoney(upfront)}</td>
                        <td className="px-3 py-2 text-right">
                          {fmtMoney(bw)} / {fmtMoney(bp)} / {fmtMoney(bc)}
                        </td>
                        <td className="px-3 py-2 max-w-[260px]">
                          <span className={eligibility.eligible ? "text-emerald-300" : "text-amber-300"}>{eligibility.text}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" disabled={block} onClick={() => startSponsorNegotiation(sp)}>
                            {slotBlocked ? "No slot" : eligibility.eligible ? "Negotiate" : "Locked"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function SalariesTab({ salaries }) {
  const totalWeekly = salaries.reduce((s, r) => s + (r.weekly || 0), 0);
  const totalMonthly = salaries.reduce((s, r) => s + (r.monthly || 0), 0);
  const totalYearly = salaries.reduce((s, r) => s + (r.yearly || 0), 0);

  return (
    <>
      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat title="Weekly total" value={fmtMoney(totalWeekly)} />
          <Stat title="Monthly total" value={fmtMoney(totalMonthly)} />
          <Stat title="Yearly total" value={fmtMoney(totalYearly)} />
          <Stat title="Headcount" value={salaries.length} />
        </CardContent>
      </Card>

      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
        <CardContent className="p-0">
          {salaries.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">No salaries configured.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#171a23] text-slate-300">
                <tr className="text-left">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2 text-right">Weekly</th>
                  <th className="px-3 py-2 text-right">Monthly</th>
                  <th className="px-3 py-2 text-right">Yearly</th>
                </tr>
              </thead>
              <tbody>
                {salaries.map((r) => (
                  <tr key={`${r.kind}_${r.id}`} className="border-t border-white/10">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">{titleCase(r.role)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.weekly)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.monthly)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.yearly)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function TransactionsTab({ transactions }) {
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("all");

  const months = useMemo(() => {
    const set = new Set();
    transactions.forEach((t) => {
      if (t.date) set.add(monthKey(t.date));
    });
    return ["all", ...Array.from(set).sort()];
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      const kind = String(t.type).toLowerCase();
      if (type !== "all" && kind !== type) return false;
      if (month !== "all" && t.date && monthKey(t.date) !== month) return false;
      if (q) {
        const hay = `${t.category || ""} ${t.desc || ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [transactions, type, month, q]);

  const total = filtered.reduce((s, t) => s + (Number(t.amount) || 0), 0);

  return (
    <>
      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={type} onChange={(e) => setType(e.target.value)} className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-2 py-1">
              <option value="all">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>

            <select value={month} onChange={(e) => setMonth(e.target.value)} className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-2 py-1">
              {months.map((m) => (
                <option key={m} value={m}>
                  {m === "all" ? "All months" : m}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Search description/category…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-1.5 w-full md:flex-1"
            />

            <div className="flex-1" />
            <div className={`text-sm font-medium ${total >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
              Total: {fmtMoney(total)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">No transactions.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#171a23] text-slate-300">
                <tr className="text-left">
                  <th className="px-3 py-2 w-32">Date</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-t border-white/10">
                    <td className="px-3 py-2">
                      {t.date
                        ? new Date(t.date).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{t.category || "—"}</td>
                    <td className="px-3 py-2">{t.desc || "—"}</td>
                    <td className={`px-3 py-2 text-right ${Number(t.amount) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {fmtMoney(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* --------------- small UI bits -------------- */
function Stat({ title, value }) {
  return (
    <Card className="!bg-[#12141c] !border-white/10 !text-slate-100">
      <CardContent className="p-4">
        <div className="text-sm text-slate-400 mb-1">{title}</div>
        <div className="text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
function Mini({ stat, val }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#171a23] p-2">
      <div className="text-[11px] text-slate-400">{stat}</div>
      <div className="text-sm font-medium">{val}</div>
    </div>
  );
}
