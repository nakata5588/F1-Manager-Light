// src/engine/EventEngine.js
import { ensureAbilityAnchor, intensiveTrainingStatus, recalculateCurrentAbility } from "../domain/driverRating.js";
import { appendDriverMentalStateLog, applyMentalStateDeltaToCondition, mentalStateCondition } from "../domain/driverMentalState.js";

/** Pequenas utils */
function pad2(n) { return String(n).padStart(2, "0"); }
export function toISODateOnly(d) {
  const dt = (d instanceof Date) ? d : new Date(d || Date.now());
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`;
}
export function addDaysISO(iso, days) {
  const d = iso ? new Date(iso) : new Date();
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return toISODateOnly(d);
}
const clampISO = (iso) => String(iso || "").slice(0, 10);

/** Normaliza driver_id: "d_0022" | "0022" | 22 -> "0022" */
function normDriverId(x) {
  if (x == null) return null;
  const m = String(x).match(/(\d+)/);
  return m ? m[1].padStart(4, "0") : null;
}

/** Procura driver e rating por id normalizado */
function findDriver(drivers, driverId) {
  const idn = normDriverId(driverId);
  return (drivers || []).find(d => normDriverId(d?.driver_id ?? d?.id ?? d?.driverId) === idn) || null;
}
function findDriverRating(ratings, driverId) {
  const idn = normDriverId(driverId);
  return (ratings || []).find(r => normDriverId(r?.driver_id ?? r?.id ?? r?.driverId) === idn) || null;
}

/** Safe get/set de caminhos aninhados (para efeitos genéricos) */
function getPath(obj, path) {
  if (!obj) return undefined;
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}
function setPath(obj, path, value) {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (let i=0;i<parts.length-1;i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length-1]] = value;
}
function applyNumericDelta(obj, path, delta, clampMin = null, clampMax = null) {
  const before = Number(getPath(obj, path) ?? 0);
  let after = before + Number(delta || 0);
  if (clampMin != null) after = Math.max(clampMin, after);
  if (clampMax != null) after = Math.min(clampMax, after);
  setPath(obj, path, after);
  return { before, after, delta: after - before };
}

/**
 * Converte uma estrutura effects_json de agenda_blocks em uma lista de efeitos planos.
 * Exemplo de input:
 * {
 *   "driver": {"cornering":"+0.5","consistency":"+0.3"},
 *   "crew": {"pit_errors":"-0.03","avg_time_s":"-0.05"},
 *   "fatigue":"+2",
 *   "money":"-50000",
 *   "team_popularity":"+2"
 * }
 */
function flattenAgendaEffects(effectsJson, evMeta = {}) {
  const out = [];
  const e = effectsJson || {};
  const asNum = (v) => (typeof v === "string" ? Number(v) : Number(v));

  // driver attribute changes
  if (e.driver && typeof e.driver === "object") {
    for (const [attr, delta] of Object.entries(e.driver)) {
      out.push({ key: "driver_attr", attr, delta: asNum(delta), driverId: evMeta?.driverId ?? evMeta?.driver_id });
    }
  }
  // pit crew
  if (e.crew && typeof e.crew === "object") {
    if (e.crew.pit_errors != null) out.push({ key: "pitcrew_error", delta: asNum(e.crew.pit_errors) });
    if (e.crew.avg_time_s != null) out.push({ key: "pitcrew_time", delta: asNum(e.crew.avg_time_s) });
  }
  // fatigue
  if (e.fatigue != null) out.push({ key: "fatigue", delta: asNum(e.fatigue) });
  // money
  if (e.money != null) out.push({ key: "money", delta: asNum(e.money) });
  // popularity
  if (e.team_popularity != null) out.push({ key: "popularity_team", delta: asNum(e.team_popularity) });
  if (e.driver_popularity != null) out.push({ key: "popularity_driver", delta: asNum(e.driver_popularity), driverId: evMeta?.driverId ?? evMeta?.driver_id });
  // synergy / race_prep / setup etc. — tratamos como efeitos genéricos com log
  if (e.synergy != null) out.push({ key: "team_synergy", delta: asNum(e.synergy) });
  if (e.race_prep != null) out.push({ key: "race_prep", delta: asNum(e.race_prep) });
  if (e.setup != null) out.push({ key: "setup", delta: asNum(e.setup) });
  if (e.car_knowledge != null) out.push({ key: "car_knowledge", delta: asNum(e.car_knowledge) });

  return out;
}

/**
 * Aplica efeitos ao estado e devolve:
 * - patched: novo gameState
 * - logLines: linhas human-readable para a mensagem do inbox
 * - changes: entradas estruturadas para o histórico do piloto (attributes tab)
 */
const INTENSIVE_TRAINING_KEYS=new Set([
  "sim_braking","sim_pace","qual_runs","wet_practice","tyre_drills","racecraft","physical",
]);

function isIntensiveTrainingEvent(ev){
  return ev?.type==="driver_action" && INTENSIVE_TRAINING_KEYS.has(String(ev?.meta?.uiKey||""));
}

function applyEffects(gs, ev, ctx) {
  // clonamos listas que vamos mexer
  const drivers = gs.drivers?.length ? gs.drivers.slice() : (gs.dbDrivers || []).slice();
  const ratingsRef = gs.driverRatings && gs.driverRatings.length ? "driverRatings" :
                     (gs.dbDriverRatings && gs.dbDriverRatings.length ? "dbDriverRatings" : null);
  const ratings = ratingsRef ? gs[ratingsRef].slice() : [];
  const driverAttributes = { ...(gs.driverAttributes || {}) };

  // histórico por piloto (dicionário)
  const driverAttrLog = { ...(gs.driverAttrLog || {}) };
  let driverMentalStateLog = { ...(gs.driverMentalStateLog || {}) };

  // seed para novos efeitos vindos de agenda_blocks (effects_json)
  const flatFromAgenda =
    ev.effects_json && !Array.isArray(ev.effects)
      ? flattenAgendaEffects(ev.effects_json, ev.meta || {})
      : [];

  const trainingDriverId=ev.meta?.driverId ?? ev.participants?.[0];
  const trainingStatus=isIntensiveTrainingEvent(ev)
    ? intensiveTrainingStatus(gs,trainingDriverId)
    : null;
  const allEffects = trainingStatus?.allowed===false
    ? []
    : [...(ev.effects || []), ...flatFromAgenda];

  const logLines = [];
  const changes  = []; // para este evento específico
  if(trainingStatus?.allowed===false){
    logLines.push("• Training cancelled: fatigue "+Math.round(trainingStatus.fatigue)+"/100 is too high. Rest is required before another intensive session.");
  }

  for (const fx of allEffects) {
    switch (fx.key) {
      case "driver_attr": {
        const driverIdRaw = fx.driverId ?? ev.meta?.driverId ?? ev.participants?.[0];
        const idn = normDriverId(driverIdRaw);
        const { attr, delta = 0 } = fx;
        const effectiveDelta=trainingStatus
          ? Number(delta)*Number(trainingStatus.efficiency||0)
          : Number(delta);

        const ratingIndex = ratings.findIndex(r => normDriverId(r?.driver_id ?? r?.id ?? r?.driverId) === idn);
        const drv = findDriver(drivers, driverIdRaw);

        if (ratingIndex >= 0 && attr && typeof ratings[ratingIndex]?.[attr] !== "undefined") {
          let rr = ensureAbilityAnchor({ ...ratings[ratingIndex] });
          const before = Number(rr[attr] ?? 0);
          const overallBefore = Number(rr.current_ability);
          const after  = Math.max(0, Math.min(100, before + effectiveDelta));
          rr[attr] = after;
          rr = recalculateCurrentAbility(rr);
          ratings[ratingIndex] = rr;
          const overallAfter = Number(rr.current_ability);

          const entry = {
            dateISO: ctx.today,
            driverId: idn,
            attr,
            before,
            after,
            delta: after-before,
            overallBefore: Number.isFinite(overallBefore) ? overallBefore : null,
            overallAfter: Number.isFinite(overallAfter) ? overallAfter : null,
            source: ev.title || ev.type || "event",
            eventId: ev.id || null,
            note: ev.meta?.note ?? null,
          };
          changes.push(entry);

          // push no dicionário (mantendo histórico)
          if (!driverAttrLog[idn]) driverAttrLog[idn] = [];
          driverAttrLog[idn] = driverAttrLog[idn].concat(entry);
          if (driverAttrLog[idn].length > 200) driverAttrLog[idn] = driverAttrLog[idn].slice(-200);

          const who = drv?.display_name || "Driver";
          const overallNote = Number.isFinite(overallBefore) && Number.isFinite(overallAfter) && overallAfter !== overallBefore
            ? ` · OVR ${overallBefore.toFixed(1)} → ${overallAfter.toFixed(1)}`
            : "";
          const appliedDelta=after-before;
          const efficiencyNote=trainingStatus&&trainingStatus.efficiency<1
            ? ` · training efficiency ${Math.round(trainingStatus.efficiency*100)}% (fatigue ${Math.round(trainingStatus.fatigue)}/100)`
            : "";
          logLines.push(`• ${who}: ${attr.replaceAll("_"," ")} ${before} → ${after} (${appliedDelta>0?"+":""}${appliedDelta.toFixed(2)})${overallNote}${efficiencyNote}`);
        } else {
          logLines.push(`• (nota) não consegui aplicar driver_attr em ${attr} (rating não encontrado).`);
        }
        break;
      }

      case "driver_condition": {
        const driverIdRaw = fx.driverId ?? ev.meta?.driverId ?? ev.participants?.[0];
        const idn = normDriverId(driverIdRaw);
        const drv = findDriver(drivers, driverIdRaw);
        const driverKey = String(drv?.driver_id ?? driverIdRaw ?? idn ?? "");
        const compat = idn ? driverAttributes[idn] : null;
        const curr = mentalStateCondition({
          ...(compat || {}),
          ...(driverAttributes[driverKey] || {}),
        });
        const attr = String(fx.attr || "");
        if (!["confidence","morale","preparation"].includes(attr)) break;
        const before = Number(curr[attr] ?? 50);
        const nextCondition = applyMentalStateDeltaToCondition(curr,{[attr]:Number(fx.delta||0)});
        const after = Number(nextCondition[attr]);
        driverAttributes[driverKey] = nextCondition;
        if (idn && idn !== driverKey && driverAttributes[idn]) delete driverAttributes[idn];
        driverMentalStateLog=appendDriverMentalStateLog(driverMentalStateLog,driverKey,{
          before:curr,
          after:nextCondition,
          source:"event",
          reason:ev.title || ev.type || "Driver event",
          dateISO:ctx.today,
          meta:{event_id:ev.id||null,event_type:ev.type||null},
        });

        const entry = {
          dateISO: ctx.today,
          driverId: idn,
          attr,
          before,
          after,
          delta: after-before,
          source: ev.title || ev.type || "event",
          eventId: ev.id || null,
          note: ev.meta?.note ?? null,
        };
        changes.push(entry);
        if (!driverAttrLog[idn]) driverAttrLog[idn] = [];
        driverAttrLog[idn] = driverAttrLog[idn].concat(entry).slice(-200);

        const who = drv?.display_name || drv?.name || driverKey;
        logLines.push(`• ${who}: ${attr} ${before.toFixed(0)} → ${after.toFixed(0)} (${after-before>0?"+":""}${(after-before).toFixed(0)})`);
        break;
      }

      case "fatigue": {
        const driverIdRaw = fx.driverId ?? ev.meta?.driverId ?? ev.participants?.[0];
        const idn = normDriverId(driverIdRaw);
        const drv = findDriver(drivers, driverIdRaw);
        const driverKey = String(drv?.driver_id ?? driverIdRaw ?? idn ?? "");
        const compat = idn ? driverAttributes[idn] : null;
        const curr = mentalStateCondition({
          ...(compat || {}),
          ...(driverAttributes[driverKey] || {}),
        });
        const before = Number(curr.fatigue ?? 0);
        const nextCondition = applyMentalStateDeltaToCondition(curr,{fatigue:Number(fx.delta||0)});
        const after = Number(nextCondition.fatigue);
        driverAttributes[driverKey] = nextCondition;
        if (idn && idn !== driverKey && driverAttributes[idn]) delete driverAttributes[idn];
        driverMentalStateLog=appendDriverMentalStateLog(driverMentalStateLog,driverKey,{
          before:curr,
          after:nextCondition,
          source:"event",
          reason:ev.title || ev.type || "Driver event",
          dateISO:ctx.today,
          meta:{event_id:ev.id||null,event_type:ev.type||null},
        });

        const entry = {
          dateISO: ctx.today,
          driverId: idn,
          attr: "fatigue",
          before,
          after,
          delta: after-before,
          source: ev.title || ev.type || "event",
          eventId: ev.id || null,
          note: ev.meta?.note ?? null,
        };
        changes.push(entry);
        if (!driverAttrLog[idn]) driverAttrLog[idn] = [];
        driverAttrLog[idn] = driverAttrLog[idn].concat(entry);
        if (driverAttrLog[idn].length > 200) driverAttrLog[idn] = driverAttrLog[idn].slice(-200);

        const who = drv?.display_name || drv?.name || driverKey;
        logLines.push(`• ${who}: fatigue ${before.toFixed(0)} → ${after.toFixed(0)} (${after-before>0?"+":""}${(after-before).toFixed(0)})`);
        break;
      }

      case "money": {
        // altera budget da equipa do jogador (se existir)
        const patchedTeam = { ...(gs.team || {}) };
        const { before, after, delta } = applyNumericDelta(patchedTeam, "budget", fx.delta, 0, null);
        logLines.push(`• Finanças: orçamento ${before.toLocaleString()} → ${after.toLocaleString()} (${delta>0?"+":""}${delta.toLocaleString()})`);
        gs = { ...gs, team: patchedTeam };
        break;
      }

      case "popularity_team": {
        const meta = gs.meta || {};
        const { before, after, delta } = applyNumericDelta(meta, "popularity.team", fx.delta, -100, 100);
        logLines.push(`• Popularidade (equipa): ${before} → ${after} (${delta>0?"+":""}${delta})`);
        gs = { ...gs, meta };
        break;
      }

      case "popularity_driver": {
        const driverIdRaw = fx.driverId ?? ev.meta?.driverId ?? ev.participants?.[0];
        const idn = normDriverId(driverIdRaw);
        const meta = { ...(gs.meta || {}) };
        const path = `popularity.drivers.${idn}`;
        const { before, after, delta } = applyNumericDelta(meta, path, fx.delta, -100, 100);
        logLines.push(`• Popularidade (piloto ${idn}): ${before} → ${after} (${delta>0?"+":""}${delta})`);
        gs = { ...gs, meta };
        break;
      }

      case "pitcrew_error": {
        const ops = { ...(gs.ops || {}) };
        const { before, after, delta } = applyNumericDelta(ops, "pitcrew.error_prob", fx.delta, 0, 1);
        logLines.push(`• Pit Crew: prob. de erro ${before.toFixed(3)} → ${after.toFixed(3)} (${delta>0?"+":""}${delta.toFixed(3)})`);
        gs = { ...gs, ops };
        break;
      }

      case "pitcrew_time": {
        const ops = { ...(gs.ops || {}) };
        const { before, after, delta } = applyNumericDelta(ops, "pitcrew.avg_time_s", fx.delta, 0, null);
        logLines.push(`• Pit Crew: tempo médio ${before.toFixed(2)}s → ${after.toFixed(2)}s (${delta>0?"+":""}${delta.toFixed(2)}s)`);
        gs = { ...gs, ops };
        break;
      }

      case "team_synergy": {
        const meta = { ...(gs.meta || {}) };
        const { before, after, delta } = applyNumericDelta(meta, "team.synergy", fx.delta, -100, 100);
        logLines.push(`• Sinergia da equipa: ${before} → ${after} (${delta>0?"+":""}${delta})`);
        gs = { ...gs, meta };
        break;
      }

      // efeitos genéricos — apenas logamos
      case "race_prep":
      case "setup":
      case "car_knowledge": {
        const key = fx.key.replaceAll("_", " ");
        logLines.push(`• ${key}: ${fx.delta>0?"+":""}${fx.delta}`);
        break;
      }

      default: {
        // efeito genérico — também o podes registar se quiseres
        const val = (fx.delta != null) ? ` (${fx.delta>0?"+":""}${fx.delta})` : "";
        logLines.push(`• Efeito: ${fx.key}${val}`);
      }
    }
  }

  // devolve gs “patchado”
  const patched = { ...gs };
  if (ratingsRef) patched[ratingsRef] = ratings;
  patched.driverAttributes = driverAttributes;
  patched.driverAttrLog = driverAttrLog;
  patched.driverMentalStateLog = driverMentalStateLog;

  return { patched, logLines, changes };
}

/** Constrói a mensagem do inbox */
function buildInboxMessage({ ev, dateISO, driver, logLines, changes }) {
  const who = driver?.display_name || driver?.name || (ev.meta?.driverName) || "Driver";
  const title = `Action • ${ev.title || ev.name || ev.type || "Event"}`;
  const lines = [
    `${who} — ${ev.meta?.uiKey || ev.type || "action"}`,
    ...(ev.meta?.note ? [String(ev.meta.note)] : []),
    "",
    "Outcome:",
    ...(logLines.length ? logLines : ["• (sem efeitos aplicados)"]),
  ];
  return {
    id: `inb_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    dateISO,
    type: "event",
    title,
    body: lines.join("\n"),
    tags: ["action","auto"],
    read: false,
    actor_driver_id: driver?.driver_id ?? null,
    // 👇 útil para UI consumir diretamente as mudanças
    changes: Array.isArray(changes) ? changes : [],
    meta_changes: Array.isArray(changes) ? changes : [], // alias
  };
}

/**
 * Motor diário: processa eventos agendados para "hoje" (<= data atual),
 * aplica efeitos e cria mensagens no Inbox. Devolve um novo gameState.
 *
 * @param {object} gs gameState atual
 * @returns {object} novo gameState com inbox/events/ratings/log atualizados
 */
export function triggerDailyTick(gs) {
  if (!gs) return gs;

  const today = clampISO(gs.currentDateISO);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(today)) {
    throw new TypeError("triggerDailyTick requires gameState.currentDateISO.");
  }
  const queue = Array.isArray(gs.eventsQueue) ? gs.eventsQueue.slice() : [];

  const drivers = gs.drivers?.length ? gs.drivers : (gs.dbDrivers || []);
  const toProcessIdx = [];

  // encontrar eventos por processar agendados para hoje ou antes
  for (let i = 0; i < queue.length; i++) {
    const ev = queue[i];
    if (ev?.done) continue;
    const d = clampISO(ev?.dateISO || ev?.date);
    if (d && d <= today) toProcessIdx.push(i);
  }

  if (!toProcessIdx.length) return gs; // nada para fazer hoje

  // Vamos aplicar efeitos e gerar inbox
  let nextState = { ...gs };
  const inbox = Array.isArray(gs.inbox) ? gs.inbox.slice() : [];

  for (const idx of toProcessIdx) {
    const ev = { ...queue[idx] };
    const driver = findDriver(drivers, ev.meta?.driverId || ev.participants?.[0]);

    const { patched, logLines, changes } = applyEffects(nextState, ev, { today });
    nextState = patched;

    // criar inbox (inclui changes estruturadas)
    const msg = buildInboxMessage({ ev, dateISO: today, driver, logLines, changes });
    inbox.push(msg);

    // marcar evento como concluído
    ev.done = true;
    queue[idx] = ev;
  }

  nextState.inbox = inbox;
  nextState.eventsQueue = queue;
  return nextState;
}

/**
 * Helper opcional: criar um evento a partir de um "agenda_block".
 * Útil para a tua UI: escolhes o bloco e eu devolvo um objeto de evento
 * pronto a enfileirar com useGame().queueEvent(...)
 *
 * @param {object} block registo de agenda_blocks (id, name, effects_json, cooldown, etc.)
 * @param {object} opts  { dateISO, currentDateISO, driverId, title, note, participants }
 */
export function scheduleEventFromBlock(block, opts = {}) {
  if (!block) return null;
  const currentDateISO = clampISO(opts.currentDateISO);
  const dateISO = clampISO(opts.dateISO || (currentDateISO ? addDaysISO(currentDateISO, 1) : ""));
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateISO)) {
    throw new TypeError("scheduleEventFromBlock requires dateISO or currentDateISO.");
  }
  const driverId = opts.driverId ?? (Array.isArray(opts.participants) ? opts.participants[0] : null);
  const effects_json = block.effects || block.effects_json || {};
  const effects = flattenAgendaEffects(effects_json, { driverId });

  return {
    id: opts.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    type: "agenda_block",
    title: opts.title || block.name || "Agenda",
    participants: Array.isArray(opts.participants) ? opts.participants : (driverId ? [driverId] : []),
    meta: {
      uiKey: block.block_id || block.id || "agenda",
      note: opts.note || "",
      driverId,
    },
    effects_json, // guardamos o original para auditoria/inspeção
    effects,      // flat para aplicar imediatamente
    dateISO,
    done: false,
  };
}
