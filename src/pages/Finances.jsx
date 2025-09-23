import React, { useMemo, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/* ----------------- utils ----------------- */
const fmtMoney = (n) => {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "EUR",
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
const N = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const pick = (obj, keys, fb) => {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};
const getTeamId = (t) => String(pick(t, ["team_id", "id", "name", "team_name", "short_name"], ""));

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

  const budget0 = Number(gameState?.finances?.budget || 0);
  const balance = budget0 + seasonNet;

  const fin = {
    budget: budget0,
    balance,
    weekly_burn: 0,
    season_spend: expense,
    season_income: income,
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

    const annual_income = N(pick(sp, ["annual_income", "value_year"], 0), 0);
    const monthly_fee = N(pick(sp, ["monthly_fee", "monthly", "per_month"], NaN), NaN) || annual_income / 12;
    const cash_upfront = N(pick(sp, ["cash_upfront", "upfront", "signing_fee"], 0), 0);

    const bonus_win = N(pick(sp, ["bonus_win", "win_bonus"], 0), 0);
    const bonus_podium = N(pick(sp, ["bonus_podium", "podium_bonus"], 0), 0);
    const bonus_championship = N(pick(sp, ["bonus_championship", "championship_bonus"], 0), 0);

    let status = "pending";
    if (today >= start && today <= end) status = "active";
    else if (today > end) status = "expired";

    const sType = String(pick(sp, ["type", "tier", "category"], "secondary")).toLowerCase();

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
      status,
    };
  });
}

function deriveSalaries(gameState) {
  const teamId = getTeamId(gameState?.team || {});

  const driversRaw = (gameState?.contracts || []).filter(
    (c) =>
      /driver/i.test(String(pick(c, ["role", "position", "contract_role", "type"], ""))) &&
      String(pick(c, ["team_id", "team", "constructor", "id"], "")) === String(teamId)
  );
  const staffRaw = (gameState?.staffContracts || []).filter(
    (c) => String(pick(c, ["team_id", "team", "constructor", "id"], "")) === String(teamId)
  );

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
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h1 className="text-2xl md:text-3xl font-semibold">Finances</h1>
        <div className="text-sm text-muted-foreground">
          Balance: <span className="font-medium">{fmtMoney(fin.balance || fin.budget)}</span>
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

  const monthlyBurn =
    salaries.reduce((s, r) => s + (r.monthly || 0), 0) -
    sponsors.reduce((s, r) => s + (r.monthly_fee || 0), 0);
  const runwayMonths =
    monthlyBurn > 0 ? Math.floor((fin.balance || fin.budget || 0) / monthlyBurn) : null;

  return (
    <>
      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat title="Budget / Balance" value={fmtMoney(fin.budget || fin.balance)} />
        <Stat title="Weekly Burn" value={fmtMoney((monthlyBurn || 0) / 4)} />
        <Stat title="Runway" value={runwayMonths != null ? `${runwayMonths} months` : "—"} />
        <Stat title="Season Net (CF est.)" value={fmtMoney((fin.season_income - fin.season_spend) || lastNet)} />
      </div>

      {/* Mini sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Latest Cashflow</div>
            {last3.length === 0 ? (
              <div className="text-sm text-muted-foreground">No cashflow data.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
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
                      <td className={`px-3 py-2 text-right ${m.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {fmtMoney(m.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">This Season (est.)</div>
            <div className="grid grid-cols-2 gap-2">
              <Mini stat="Sponsor (est.)" val={fmtMoney(sponsorEstYear)} />
              <Mini stat="Salaries (est.)" val={fmtMoney(salaryYear)} />
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
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">No cashflow data.</CardContent>
      </Card>
    );
  }
  const maxAbs = Math.max(1, ...cashflow.map((m) => Math.abs(m.net)));
  return (
    <Card>
      <CardContent className="p-4">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
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
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">{m.month}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(m.income)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(m.expense)}</td>
                  <td className={`px-3 py-2 text-right ${m.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {fmtMoney(m.net)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full bg-muted/40 rounded">
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
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(
    () => sponsors.filter((s) => (status === "all" ? true : s.status === status)),
    [sponsors, status]
  );

  const totalMonthly = filtered.reduce((s, r) => s + (r.monthly_fee || 0), 0);
  const totalUpfront = filtered.reduce((s, r) => s + (r.cash_upfront || 0), 0);

  // slots: 1 main, 3 secondary (ativos no ano)
  const activeMains = sponsors.filter((s) => s.type === "main" && s.status !== "expired");
  const activeSeconds = sponsors.filter((s) => s.type !== "main" && s.status !== "expired");
  const canAddMain = activeMains.length < 1;
  const canAddSecondary = activeSeconds.length < 3;

  const loadCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/data/core_sponsor_catalog.json", { cache: "no-store" });
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

      // respeitar slots
      const filteredBySlots = avail.filter((sp) => {
        const t = String(pick(sp, ["type", "tier", "category"], "secondary")).toLowerCase();
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

  const signSponsor = useCallback(
    (sp) => {
      const type = String(pick(sp, ["type", "tier", "category"], "secondary")).toLowerCase();
      if (type === "main" && !canAddMain) return;
      if (type !== "main" && !canAddSecondary) return;

      const sponsor_id = String(pick(sp, ["sponsor_id", "id", "name"]));
      const sponsor_name = String(pick(sp, ["sponsor_name", "name"], sponsor_id));

      // construir contrato para sponsors_contracts
      const monthly_fee =
        N(pick(sp, ["monthly_fee", "monthly", "per_month"], NaN), NaN) ||
        N(pick(sp, ["annual_income", "value_year"], 0), 0) / 12;
      const annual_income = N(pick(sp, ["annual_income", "value_year"], Math.round((monthly_fee || 0) * 12)), 0);
      const cash_upfront = N(pick(sp, ["cash_upfront", "upfront", "signing_fee"], 0), 0);

      const bonus_win = N(pick(sp, ["bonus_win", "win_bonus"], 0), 0);
      const bonus_podium = N(pick(sp, ["bonus_podium", "podium_bonus"], 0), 0);
      const bonus_championship = N(pick(sp, ["bonus_championship", "championship_bonus"], 0), 0);

      const newContract = {
        sponsor_id,
        sponsor_name,
        team_id: teamId,
        type,
        start_year: Y,
        end_year: Y,
        start_date: `${Y}-01-02`, // upfront a 02/01
        end_date: `${Y}-12-31`,
        monthly_fee: Math.round(monthly_fee || 0),
        annual_income: Math.round(annual_income || 0),
        cash_upfront: Math.round(cash_upfront || 0),
        bonus_win,
        bonus_podium,
        bonus_championship,
        status: "active",
      };

      // atualizar state: sponsorsContracts + financeLog (upfront imediato)
      setGameState((prev) => {
        const gs = typeof prev === "function" ? prev : prev; // compat
        const state = (gs && gs.gameState) || gs; // aceita ambos patterns do setGameState
        const base = state || gameState;

        const sponsorsContracts = Array.isArray(base.sponsorsContracts)
          ? [...base.sponsorsContracts, newContract]
          : [newContract];

        const tx = {
          id: `tx_sp_upfront_${Date.now()}`,
          dateISO: todayISO,
          type: "income",
          category: "Sponsor Upfront",
          desc: sponsor_name,
          amount: newContract.cash_upfront,
        };
        const financeLog = Array.isArray(base.financeLog) ? [...base.financeLog, tx] : [tx];

        const nextBudget = Number(base?.team?.budget || 0) + Number(newContract.cash_upfront || 0);
        const team = { ...(base.team || {}), budget: nextBudget };

        return { ...base, sponsorsContracts, financeLog, team };
      });

      // feedback local
      alert(`Signed sponsor: ${sponsor_name} (${titleCase(type)})`);
    },
    [Y, teamId, todayISO, setGameState, gameState, canAddMain, canAddSecondary]
  );

  return (
    <>
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border rounded px-2 py-1"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="pending">Pending</option>
            </select>
            <div className="text-sm text-muted-foreground">
              {filtered.length} sponsors • Monthly {fmtMoney(totalMonthly)} • Upfront {fmtMoney(totalUpfront)}
            </div>
          </div>
          <div className="flex-1" />
          <Button variant="outline" onClick={loadCatalog} disabled={loading}>
            {loading ? "Loading…" : "Sign new sponsor"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No sponsors.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2">Sponsor</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Monthly</th>
                  <th className="px-3 py-2 text-right">Annual (info)</th>
                  <th className="px-3 py-2 text-right">Upfront</th>
                  <th className="px-3 py-2 text-right">Bonus (W / P / Ch)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={`${s.sponsor_id}_${s.startYear}`} className="border-t">
                    <td className="px-3 py-2">{s.name}</td>
                    <td className="px-3 py-2">{titleCase(s.type)}</td>
                    <td className="px-3 py-2">{titleCase(s.status)}</td>
                    <td className="px-3 py-2">
                      {s.startISO} → {s.endISO}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.monthly_fee)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.annual_income)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.cash_upfront)}</td>
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

      {catalog && (
        <Card>
          <CardContent className="p-0">
            {catalog.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No available sponsors (check slot limits or year activity).
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr className="text-left">
                    <th className="px-3 py-2">Sponsor</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Active (years)</th>
                    <th className="px-3 py-2 text-right">Monthly</th>
                    <th className="px-3 py-2 text-right">Annual (info)</th>
                    <th className="px-3 py-2 text-right">Upfront</th>
                    <th className="px-3 py-2 text-right">Bonus (W / P / Ch)</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((sp) => {
                    const t = String(pick(sp, ["type", "tier", "category"], "secondary")).toLowerCase();
                    const block =
                      (t === "main" && !canAddMain) || (t !== "main" && !canAddSecondary);
                    const monthly =
                      N(pick(sp, ["monthly_fee", "monthly", "per_month"], NaN), NaN) ||
                      N(pick(sp, ["annual_income", "value_year"], 0), 0) / 12;
                    const annual = N(pick(sp, ["annual_income", "value_year"], Math.round((monthly || 0) * 12)), 0);
                    const upfront = N(pick(sp, ["cash_upfront", "upfront", "signing_fee"], 0), 0);
                    const bw = N(pick(sp, ["bonus_win", "win_bonus"], 0), 0);
                    const bp = N(pick(sp, ["bonus_podium", "podium_bonus"], 0), 0);
                    const bc = N(pick(sp, ["bonus_championship", "championship_bonus"], 0), 0);
                    const from = pick(sp, ["start_year", "from_year"], "—");
                    const to = pick(sp, ["end_year", "to_year"], "—");

                    return (
                      <tr key={String(pick(sp, ["sponsor_id", "id", "name"]))} className="border-t">
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
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" disabled={block} onClick={() => signSponsor(sp)}>
                            {block ? "No slot" : "Sign"}
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
      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat title="Weekly total" value={fmtMoney(totalWeekly)} />
          <Stat title="Monthly total" value={fmtMoney(totalMonthly)} />
          <Stat title="Yearly total" value={fmtMoney(totalYearly)} />
          <Stat title="Headcount" value={salaries.length} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {salaries.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No salaries configured.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
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
                  <tr key={`${r.kind}_${r.id}`} className="border-t">
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
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={type} onChange={(e) => setType(e.target.value)} className="border rounded px-2 py-1">
              <option value="all">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>

            <select value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-2 py-1">
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
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />

            <div className="flex-1" />
            <div className={`text-sm font-medium ${total >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              Total: {fmtMoney(total)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No transactions.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2 w-32">Date</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-t">
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
                    <td className={`px-3 py-2 text-right ${Number(t.amount) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
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
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground mb-1">{title}</div>
        <div className="text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
function Mini({ stat, val }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[11px] text-muted-foreground">{stat}</div>
      <div className="text-sm font-medium">{val}</div>
    </div>
  );
}
