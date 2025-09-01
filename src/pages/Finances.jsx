// src/pages/Finances.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";

/* ----------------- utils ----------------- */
const fmtMoney = (n) => {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n || 0)); }
  catch { return `${n}`; }
};
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v);
};
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const titleCase = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

const tryFetchJSON = async (paths) => {
  for (const p of paths) {
    try { const r = await fetch(p); if (r.ok) return await r.json(); } catch {}
  }
  return null;
};

/* ------------- normalizers -------------- */
function normalizeFinances(raw) {
  if (!raw || typeof raw !== "object") return { budget: 0, balance: 0, weekly_burn: 0, season_spend: 0, season_income: 0 };
  const f = raw;
  return {
    budget: Number(f.budget ?? f.cash ?? 0),
    balance: Number(f.balance ?? f.bank ?? f.cash_reserve ?? f.budget ?? 0),
    weekly_burn: Number(f.weekly_burn ?? f.burn ?? 0),
    season_spend: Number(f.season_spend ?? f.spend ?? 0),
    season_income: Number(f.season_income ?? f.income ?? 0),
  };
}

function normalizeCashflow(raw) {
  // aceita { months:[{month:"1980-01", income, expense }] } ou array direto
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.months) ? raw.months : [];
  return arr.map((m, i) => {
    const month = m.month ?? m.period ?? `M_${i+1}`;
    const income = Number(m.income ?? m.in ?? 0);
    const expense = Number(m.expense ?? m.out ?? m.spend ?? 0);
    return { month, income, expense, net: income - expense };
  });
}

function normalizeSponsors(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  // campos: name, type (Title/Primary/Secondary), value_year, upfront, per_race, bonus (obj), status
  return arr.map((s, i) => ({
    id: s.id ?? `SP_${i}`,
    name: s.name ?? "Sponsor",
    type: s.type ?? s.tier ?? "Secondary",
    status: (s.status ?? "active").toLowerCase(),
    value_year: Number(s.value_year ?? s.annual ?? 0),
    upfront: Number(s.upfront ?? 0),
    per_race: Number(s.per_race ?? 0),
    bonus: s.bonus ?? s.bonuses ?? null,
    since: toDate(s.since ?? null),
    until: toDate(s.until ?? null),
  }));
}

function normalizeSalaries(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  // aceita driver/staff entries; campos: name, role, weekly, yearly
  return arr.map((r, i) => {
    const weekly = Number(r.weekly ?? (r.yearly ? Number(r.yearly)/52 : 0));
    const yearly = Number(r.yearly ?? weekly * 52);
    return {
      id: r.id ?? `SAL_${i}`,
      name: r.name ?? r.person ?? "Person",
      role: r.role ?? r.type ?? "Staff",
      weekly, yearly
    };
  });
}

function normalizeTransactions(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  // campos: date, type (income/expense), category, desc, amount
  return arr.map((t, i) => ({
    id: t.id ?? `TX_${i}`,
    date: toDate(t.date ?? t.when ?? null),
    type: (t.type ?? (Number(t.amount) >= 0 ? "income" : "expense")).toLowerCase(),
    category: t.category ?? t.cat ?? "Other",
    desc: t.desc ?? t.description ?? "",
    amount: Number(t.amount ?? 0),
  })).sort((a,b) => (b.date?.getTime?.()||0) - (a.date?.getTime?.()||0));
}

/* ---------------- component --------------- */
export default function Finances() {
  const { gameState } = useGame();

  const [fallbackFin, setFallbackFin] = useState(null);
  const [fallbackCash, setFallbackCash] = useState(null);
  const [fallbackSponsors, setFallbackSponsors] = useState(null);
  const [fallbackSalaries, setFallbackSalaries] = useState(null);
  const [fallbackTx, setFallbackTx] = useState(null);

  useEffect(() => {
    (async () => {
      const [fin, cash, sps, sal, tx] = await Promise.all([
        tryFetchJSON(["/data/finances.json"]),
        tryFetchJSON(["/data/cashflow.json"]),
        tryFetchJSON(["/data/sponsors.json"]),
        tryFetchJSON(["/data/salaries.json"]),
        tryFetchJSON(["/data/transactions.json"]),
      ]);
      setFallbackFin(fin);
      setFallbackCash(cash);
      setFallbackSponsors(sps);
      setFallbackSalaries(sal);
      setFallbackTx(tx);
    })();
  }, []);

  // normalize
  const fin = useMemo(() => normalizeFinances(gameState?.finances || fallbackFin || {}), [gameState?.finances, fallbackFin]);
  const cashflow = useMemo(() => normalizeCashflow((gameState?.finances && gameState.finances.cashflow) || fallbackCash || []), [gameState?.finances, fallbackCash]);
  const sponsors = useMemo(() => normalizeSponsors((gameState?.finances && gameState.finances.sponsors) || fallbackSponsors || []), [gameState?.finances, fallbackSponsors]);
  const salaries = useMemo(() => normalizeSalaries((gameState?.finances && gameState.finances.salaries) || fallbackSalaries || []), [gameState?.finances, fallbackSalaries]);
  const transactions = useMemo(() => normalizeTransactions((gameState?.finances && gameState.finances.transactions) || fallbackTx || []), [gameState?.finances, fallbackTx]);

  // derived
  const monthlyBurn = useMemo(() => fin.weekly_burn * 4, [fin.weekly_burn]);
  const runwayMonths = useMemo(() => {
    if (monthlyBurn <= 0) return null;
    const total = fin.budget || fin.balance || 0;
    return Math.max(0, Math.floor(total / monthlyBurn));
  }, [fin.budget, fin.balance, monthlyBurn]);

  // tabs
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
          ["overview","Overview"],
          ["cashflow","Cashflow"],
          ["sponsors","Sponsors"],
          ["salaries","Salaries"],
          ["transactions","Transactions"],
        ].map(([k,label]) => (
          <Button key={k} variant={tab===k ? "default":"outline"} onClick={()=>setTab(k)}>{label}</Button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab fin={fin} cashflow={cashflow} sponsors={sponsors} salaries={salaries} transactions={transactions} />}
      {tab === "cashflow" && <CashflowTab cashflow={cashflow} />}
      {tab === "sponsors" && <SponsorsTab sponsors={sponsors} />}
      {tab === "salaries" && <SalariesTab salaries={salaries} />}
      {tab === "transactions" && <TransactionsTab transactions={transactions} />}
    </div>
  );
}

/* ---------------- tabs ------------------- */
function OverviewTab({ fin, cashflow, sponsors, salaries, transactions }) {
  const monthlyBurn = fin.weekly_burn * 4;
  const runwayMonths = monthlyBurn > 0 ? Math.max(0, Math.floor((fin.budget || fin.balance || 0) / monthlyBurn)) : null;

  const last3 = (cashflow || []).slice(-3);
  const lastNet = last3.reduce((s, m) => s + (m.net || 0), 0);

  const sponsorYear = sponsors.reduce((s, sp) => s + (sp.value_year || 0) + (sp.per_race || 0)*16 + (sp.upfront || 0), 0);
  const salaryYear = salaries.reduce((s, r) => s + (r.yearly || 0), 0);

  return (
    <>
      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Stat title="Budget / Balance" value={fmtMoney(fin.budget || fin.balance)} />
        <Stat title="Weekly Burn" value={fmtMoney(fin.weekly_burn)} />
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
                      <td className={`px-3 py-2 text-right ${m.net >= 0 ? "text-emerald-700":"text-rose-700"}`}>{fmtMoney(m.net)}</td>
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
              <Mini stat="Sponsor (est.)" val={fmtMoney(sponsorYear)} />
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
    return <Card><CardContent className="p-4 text-sm text-muted-foreground">No cashflow data.</CardContent></Card>;
  }

  const maxAbs = Math.max(1, ...cashflow.map(m => Math.abs(m.net)));

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
                  <td className={`px-3 py-2 text-right ${m.net >= 0 ? "text-emerald-700":"text-rose-700"}`}>{fmtMoney(m.net)}</td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full bg-muted/40 rounded">
                      <div className="h-2 rounded" style={{ width: `${w}%`, background: m.net >= 0 ? "var(--green, #16a34a)" : "var(--red, #dc2626)" }} />
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
  const [status, setStatus] = useState("all"); // all|active|expired|pending
  const filtered = useMemo(() => sponsors.filter(s => status==="all" ? true : s.status===status), [sponsors, status]);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <select value={status} onChange={(e)=>setStatus(e.target.value)} className="border rounded px-2 py-1">
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="pending">Pending</option>
            </select>
            <div className="text-sm text-muted-foreground">{filtered.length} sponsors</div>
          </div>
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
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Upfront</th>
                  <th className="px-3 py-2 text-right">Per race</th>
                  <th className="px-3 py-2 text-right">Yearly</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Term</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2">{s.type}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.upfront)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.per_race)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(s.value_year)}</td>
                    <td className="px-3 py-2">{titleCase(s.status)}</td>
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
    </>
  );
}

function SalariesTab({ salaries }) {
  const totalWeekly = salaries.reduce((s, r) => s + (r.weekly || 0), 0);
  const totalYearly = salaries.reduce((s, r) => s + (r.yearly || 0), 0);

  return (
    <>
      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat title="Weekly total" value={fmtMoney(totalWeekly)} />
          <Stat title="Yearly total" value={fmtMoney(totalYearly)} />
          <Stat title="Headcount" value={salaries.length} />
          <div />
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
                  <th className="px-3 py-2 text-right">Yearly</th>
                </tr>
              </thead>
              <tbody>
                {salaries.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.weekly)}</td>
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
  const [type, setType] = useState("all"); // all|income|expense
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("all");

  const months = useMemo(() => {
    const set = new Set();
    transactions.forEach(t => { if (t.date) set.add(monthKey(t.date)); });
    return ["all", ...Array.from(set).sort()];
  }, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (type !== "all" && t.type !== type) return false;
      if (month !== "all" && t.date && monthKey(t.date) !== month) return false;
      if (q) {
        const hay = `${t.category} ${t.desc}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [transactions, type, month, q]);

  const total = filtered.reduce((s, t) => s + (t.amount || 0), 0);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <select value={type} onChange={(e)=>setType(e.target.value)} className="border rounded px-2 py-1">
              <option value="all">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>

            <select value={month} onChange={(e)=>setMonth(e.target.value)} className="border rounded px-2 py-1">
              {months.map(m => <option key={m} value={m}>{m==="all" ? "All months" : m}</option>)}
            </select>

            <input
              type="text"
              placeholder="Search description/category…"
              value={q}
              onChange={(e)=>setQ(e.target.value)}
              className="border rounded px-3 py-1.5 w-full md:flex-1"
            />

            <div className="flex-1" />
            <div className={`text-sm font-medium ${total>=0 ? "text-emerald-700":"text-rose-700"}`}>
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
                    <td className="px-3 py-2">{t.date ? t.date.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "—"}</td>
                    <td className="px-3 py-2">{t.category}</td>
                    <td className="px-3 py-2">{t.desc}</td>
                    <td className={`px-3 py-2 text-right ${t.amount>=0 ? "text-emerald-700":"text-rose-700"}`}>{fmtMoney(t.amount)}</td>
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
