/* eslint-disable no-console */

// =================== helpers de datas ===================
const clampISO = (iso) => String(iso || "").slice(0, 10);
const parseISO = (iso) => {
  if (!iso) return new Date(NaN);
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y || 0, (m || 1) - 1, d || 1));
};
const isFirstOfMonth = (iso) => parseISO(iso).getUTCDate() === 1;
const endOfPrevMonth = (iso) => {
  const d = parseISO(iso);
  d.setUTCDate(1);  // 1º do mês corrente
  d.setUTCDate(0);  // último dia do mês anterior
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const yyyymm = (iso) => clampISO(iso).slice(0, 7);

// =================== helpers genéricos ===================
const N = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const pick = (obj, keys, fb = undefined) => {
  for (const k of keys) {
    const v = obj ? obj[k] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};
const getTeamId = (t) =>
  String(pick(t, ["team_id", "id", "name", "team_name", "short_name"], ""));

function filterByYear(records, year) {
  const y = Number(year);
  return (records || []).filter((r) => {
    const direct = pick(r, ["year", "season_year", "season", "yr", "y"], null);
    if (direct != null && direct !== "") return Number(direct) === y;

    const start = Number(pick(r, ["start_year", "from_year", "first_year", "year_start", "from", "start"], NaN));
    const endRaw = pick(r, ["end_year", "to_year", "last_year", "year_end", "to", "end"], "");
    const end = endRaw === "" || endRaw == null ? Infinity : Number(endRaw);
    if (!Number.isNaN(start) || end !== Infinity) {
      return y >= (Number.isNaN(start) ? -Infinity : start) && y <= end;
    }

    const dateLike = pick(r, ["date", "race_date", "start_date", "end_date"], "");
    if (typeof dateLike === "string" && dateLike.length >= 4) {
      const maybe = Number(dateLike.slice(0, 4));
      return maybe === y;
    }
    return false;
  });
}

function findBrandRowForTeam(gs, year, teamId) {
  const list = filterByYear(gs.dbTeamBrands || [], year);
  return (list || []).find((r) => {
    const tid = String(pick(r, ["team_id", "team", "constructor", "id"], ""));
    if (tid && String(teamId) === tid) return true;
    const rn = pick(r, ["team_name", "short_name", "name"], "");
    const tn = pick(gs.team, ["team_name", "short_name", "name"], "");
    return rn && tn && rn.toLowerCase().replace(/[^a-z0-9]+/g, "") === tn.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }) || null;
}

function findContracts(gs, year, type /* "driver"|"staff" */) {
  const arr = filterByYear(type === "staff" ? (gs.dbStaffContracts || []) : (gs.dbContracts || []), year);
  if (type === "driver") {
    return arr.filter((c) => /driver/i.test(String(pick(c, ["role","position","contract_role","type"], ""))));
  }
  return arr;
}

function findTeamEngineRow(gs, year, teamId) {
  const arr = filterByYear(gs.dbTeamEngines || [], year);
  return (arr || []).find((r) => {
    const tid = String(pick(r, ["team_id","team","constructor","id"], ""));
    return tid === String(teamId);
  }) || null;
}

function findSponsorContracts(gs, year, teamId) {
  const arr = filterByYear(gs.dbSponsorsContracts || [], year);
  return (arr || []).filter((r) => {
    const tid = String(pick(r, ["team_id","team","constructor","id"], ""));
    return tid === String(teamId);
  });
}

// =================== ledger + flags ===================
function pushTxn(gs, { id, sig, dateISO, type, category, desc, amount }) {
  const amt = N(amount, 0);
  const tx = {
    id: id || `tx_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    sig: sig || null, // para dedupe, quando aplicável
    dateISO: clampISO(dateISO),
    type: amt >= 0 ? "income" : "expense",
    category: category || (amt >= 0 ? "Income" : "Expense"),
    desc: desc || "",
    amount: amt,
  };
  const financeLog = Array.isArray(gs.financeLog) ? gs.financeLog.slice() : [];
  // evita duplicar por sig
  if (tx.sig && financeLog.some((t) => t.sig === tx.sig)) return gs;

  financeLog.unshift(tx);

  // ajusta snapshot de orçamento (se existir)
  const team = { ...(gs.team || {}) };
  if (Number.isFinite(N(team.budget, NaN))) {
    team.budget = N(team.budget, 0) + amt;
  }

  const finances = { ...(gs.finances || {}) };
  finances.season_spend = N(finances.season_spend, 0) + (amt < 0 ? Math.abs(amt) : 0);
  finances.season_income = N(finances.season_income, 0) + (amt > 0 ? amt : 0);
  finances.balance = N(finances.balance, 0) + amt;

  return { ...gs, financeLog, team, finances };
}

function flagWasSet(gs, key) {
  const f = gs.financeFlags || {};
  return !!f[key];
}
function setFlag(gs, key) {
  const f = { ...(gs.financeFlags || {}) };
  f[key] = true;
  return { ...(gs || {}), financeFlags: f };
}

// =================== email resumo mensal ===================
function formatMoney(n) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      Number(n || 0)
    );
  } catch {
    return `${n}`;
  }
}
function makeMonthlyInbox(todayISO, txs) {
  if (!txs.length) return null;
  const month = yyyymm(endOfPrevMonth(todayISO));
  const inc = txs.filter((t) => t.amount > 0).reduce((s, t) => s + (t.amount || 0), 0);
  const exp = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const net = inc - exp;

  const lines = txs
    .slice()
    .reverse() // ordem cronológica
    .map((t) => `• ${t.type === "income" ? "+" : "-"} ${t.category} — ${t.desc}: ${formatMoney(t.amount)}`)
    .join("\n");

  return {
    id: `mail_fin_${month}`,
    date: todayISO,
    from: "Finance Dept.",
    tag: "Finance",
    subject: `Monthly Cashflow — ${month}`,
    body: `Summary for ${month}:\n\nIncome: ${formatMoney(inc)}\nExpense: ${formatMoney(-exp)}\nNet: ${formatMoney(net)}\n\nDetails:\n${lines}`,
  };
}

// =================== processadores ===================

// 1) Upfront de sponsors (uma vez quando chega a data)
function processSponsorsUpfront(gs) {
  const y = gs.activeYear || 1980;
  const teamId = getTeamId(gs.team || {});
  if (!teamId) return gs;

  const sponsors = findSponsorContracts(gs, y, teamId);
  let next = gs;

  for (const sp of sponsors) {
    const startDate = String(pick(sp, ["start_date", "since", "date_start"], `${y}-01-01`)).slice(0, 10);
    const sig = `sp_upfront:${y}:${teamId}:${String(pick(sp, ["sponsor_id", "id", "name"], "X"))}`;
    if (flagWasSet(next, sig)) continue;

    const upfront = N(pick(sp, ["cash_upfront", "upfront", "signing_fee"], 0), 0);
    if (upfront > 0 && clampISO(gs.currentDateISO) >= startDate) {
      next = pushTxn(next, {
        dateISO: clampISO(gs.currentDateISO),
        type: "income",
        category: "Sponsor - Upfront",
        desc: String(pick(sp, ["sponsor_name", "name", "id"], "Sponsor")),
        amount: upfront,
        sig,
      });
      next = setFlag(next, sig);
    }
  }
  return next;
}

// 2) Fecho mensal (executa no dia 1 → fecha mês anterior)
function processMonthEnd(gs) {
  const today = clampISO(gs.currentDateISO);
  if (!isFirstOfMonth(today)) return gs;

  const y = gs.activeYear || 1980;
  const prevMonthISO = endOfPrevMonth(today); // data em que vamos lançar os movimentos
  const prevKey = yyyymm(prevMonthISO);
  const teamId = getTeamId(gs.team || {});
  if (!teamId) return gs;

  const guardKey = `monthend_${prevKey}_${teamId}`;
  if (flagWasSet(gs, guardKey)) return gs;

  let next = gs;
  const freshTx = [];

  // 2.1 Sponsors — uma linha por sponsor (mensalidade)
  const sponsors = findSponsorContracts(gs, y, teamId);
  for (const sp of sponsors) {
    const name = String(pick(sp, ["sponsor_name", "name"], "Sponsor"));
    const sponsorId = String(pick(sp, ["sponsor_id", "id", "name"], name));
    const monthly =
      N(pick(sp, ["monthly_fee", "monthly", "per_month"], NaN), NaN) ||
      (N(pick(sp, ["annual_income", "value_year"], 0), 0) / 12);

    if (monthly && Math.abs(monthly) > 0) {
      const tx = {
        dateISO: prevMonthISO,
        type: "income",
        category: "Sponsor - Monthly",
        desc: name,
        amount: Math.round(Math.abs(monthly)),
        sig: `spM:${prevKey}:${teamId}:${sponsorId}`,
      };
      next = pushTxn(next, tx);
      freshTx.push({ ...tx, type: "income" });
    }
  }

  // 2.2 Staff — uma linha por pessoa
  const staff = findContracts(gs, y, "staff").filter(
    (c) => String(pick(c, ["team_id", "team", "constructor", "id"], "")) === String(teamId)
  );
  for (const c of staff) {
    const yearly = N(pick(c, ["salary_year", "salary", "annual_salary", "yearly", "value_year"], 0), 0);
    const monthly = Math.round(yearly / 12);
    if (!monthly) continue;
    const name = pick(c, ["name", "staff_name", "person_name"], "Staff");
    const role = pick(c, ["role", "position", "job"], "Staff");
    const cid = String(pick(c, ["id", "staff_id", "person_id"], name));
    const tx = {
      dateISO: prevMonthISO,
      type: "expense",
      category: "Salary - Staff",
      desc: `${name} (${role})`,
      amount: -Math.abs(monthly),
      sig: `salS:${prevKey}:${teamId}:${cid}`,
    };
    next = pushTxn(next, tx);
    freshTx.push({ ...tx, type: "expense" });
  }

  // 2.3 Pilotos — uma linha por piloto
  const drivers = findContracts(gs, y, "driver").filter(
    (c) => String(pick(c, ["team_id", "team", "constructor", "id"], "")) === String(teamId)
  );
  for (const c of drivers) {
    const yearly = N(pick(c, ["salary_year", "salary", "annual_salary", "yearly", "value_year"], 0), 0);
    const monthly = Math.round(yearly / 12);
    if (!monthly) continue;
    const name = pick(c, ["driver_name", "name"], "Driver");
    const did = String(pick(c, ["driver_id", "person_id", "id"], name));
    const tx = {
      dateISO: prevMonthISO,
      type: "expense",
      category: "Salary - Driver",
      desc: name,
      amount: -Math.abs(monthly),
      sig: `salD:${prevKey}:${teamId}:${did}`,
    };
    next = pushTxn(next, tx);
    freshTx.push({ ...tx, type: "expense" });
  }

  // 2.4 Manutenção de facilities
  const brand = findBrandRowForTeam(gs, y, teamId);
  const maintYear = N(pick(brand, ["maintenance_cost", "maintenance", "facilities_maintenance"], 0), 0);
  const maintMonthly = Math.round(maintYear / 12);
  if (maintMonthly) {
    const tx = {
      dateISO: prevMonthISO,
      type: "expense",
      category: "Facilities - Maintenance",
      desc: prevKey,
      amount: -Math.abs(maintMonthly),
      sig: `maint:${prevKey}:${teamId}`,
    };
    next = pushTxn(next, tx);
    freshTx.push({ ...tx, type: "expense" });
  }

  // 2.5 RD Projects (se existirem) — opcionalmente por projeto
  const rdList = Array.isArray(gs.rdProjectsActive) ? gs.rdProjectsActive : [];
  for (const p of rdList) {
    const monthly = N(p.costMonthly ?? p.monthly_cost ?? p.cost ?? 0, 0);
    if (!monthly) continue;
    const pid = String(p.id ?? p.key ?? p.name ?? Math.random().toString(36).slice(2, 7));
    const tx = {
      dateISO: prevMonthISO,
      type: "expense",
      category: "R&D",
      desc: String(p.name ?? p.area ?? "Project"),
      amount: -Math.abs(monthly),
      sig: `rd:${prevKey}:${teamId}:${pid}`,
    };
    next = pushTxn(next, tx);
    freshTx.push({ ...tx, type: "expense" });
  }

  // Email resumo
  const mail = makeMonthlyInbox(today, freshTx);
  if (mail) next = { ...next, inbox: [mail, ...(next.inbox || [])] };

  next = setFlag(next, guardKey);
  return next;
}

// 3) Operacional (carro novo / peças) caso uses filas pendentes
function processOperationalQueues(gs) {
  let next = gs;
  const q = Array.isArray(gs.financePending) ? gs.financePending.slice() : [];
  const remaining = [];

  for (const it of q) {
    if (it.done) { remaining.push(it); continue; }

    if (it.type === "new_car") {
      const y = gs.activeYear || 1980;
      const teamId = getTeamId(gs.team || {});
      const engineRow = findTeamEngineRow(gs, y, teamId);
      const cost = N(pick(engineRow, ["supply_cost", "chassis_cost", "car_supply_cost"], 0), 0);
      if (cost > 0) {
        next = pushTxn(next, {
          dateISO: clampISO(gs.currentDateISO),
          type: "expense",
          category: "New Car",
          desc: `Season ${y}`,
          amount: -Math.abs(cost),
          sig: `newcar:${y}:${teamId}`,
        });
      }
      remaining.push({ ...it, done: true });
      continue;
    }

    if (it.type === "part") {
      const y = gs.activeYear || 1980;
      const teamId = getTeamId(gs.team || {});
      const engineRow = findTeamEngineRow(gs, y, teamId);
      const base = N(pick(engineRow, ["supply_cost"], 0), 0);
      const diff = N(it.costDifferential ?? it.diff ?? 0, 0);
      const amount = N(it.amount, (base * diff) || 0);
      if (amount > 0) {
        next = pushTxn(next, {
          dateISO: clampISO(gs.currentDateISO),
          type: "expense",
          category: `Part - ${String(it.partKey || "component").toUpperCase()}`,
          desc: "Replacement/Manufacture",
          amount: -Math.abs(amount),
          sig: `part:${yyyymm(gs.currentDateISO)}:${teamId}:${String(it.partKey || "x")}`,
        });
      }
      remaining.push({ ...it, done: true });
      continue;
    }

    remaining.push(it);
  }

  if (remaining.length !== q.length) {
    next = { ...next, financePending: remaining };
  }
  return next;
}

// 4) Bónus de campeonato (no fim da época)
function processSeasonBonuses(gs) {
  const y = gs.activeYear || 1980;
  const lastIdx = Math.max(0, (gs.calendar?.length || 1) - 1);
  const seasonOver =
    (gs.currentRound || 0) >= lastIdx &&
    gs.standings &&
    Array.isArray(gs.standings.drivers) &&
    gs.standings.drivers.length;

  if (!seasonOver) return gs;

  const key = `season_bonus_${y}`;
  if (flagWasSet(gs, key)) return gs;

  const champDriver = gs.standings.drivers[0];
  const drivers = findContracts(gs, y, "driver");
  const rec = drivers.find((c) => String(pick(c, ["driver_id", "person_id", "id"], "")) === String(champDriver?.driver_id));

  let next = gs;
  const bonus = N(pick(rec, ["bonus_championship", "championship_bonus"], 0), 0);
  if (bonus > 0) {
    next = pushTxn(next, {
      dateISO: clampISO(gs.currentDateISO),
      type: "expense",
      category: "Driver Bonus - Championship",
      desc: String(pick(rec, ["driver_name", "name"], champDriver?.name || "Champion")),
      amount: -Math.abs(bonus),
      sig: `bonusChamp:${y}:${String(champDriver?.driver_id || "x")}`,
    });
  }

  next = setFlag(next, key);
  return next;
}

// =================== API pública ===================
export function applyEconomyTick(state) {
  try {
    let gs = { ...(state || {}) };

    if (!Array.isArray(gs.financeLog)) gs.financeLog = [];
    if (!gs.team) gs.team = { name: "Team", budget: 0 };
    if (!gs.finances) gs.finances = { budget: N(gs.team.budget, 0), balance: N(gs.team.budget, 0), weekly_burn: 0, season_spend: 0, season_income: 0 };

    // NOTA: Não lançamos "Starting Budget" no ledger (fica só no snapshot).

    // 1) sponsors upfront (quando chegar a data)
    gs = processSponsorsUpfront(gs);

    // 2) fecho mensal (dia 1 → fechar mês anterior + email)
    gs = processMonthEnd(gs);

    // 3) filas operacionais (carro/peças/RD)
    gs = processOperationalQueues(gs);

    // 4) bónus de campeão (no fecho da época)
    gs = processSeasonBonuses(gs);

    return gs;
  } catch (e) {
    console.warn("[EconomyEngine] applyEconomyTick failed:", e);
    return state;
  }
}
