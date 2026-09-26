import { triggerDailyTick } from "./EventEngine.js";
import { processScoutingTick } from "./ScoutingEngine.js";
import { refreshDriverAvailability } from "./InjuryEngine.js";
import { applyRulesTick } from "./RuleEngine.js";
import { applyProgressionTick } from "./ProgressionEngine.js";
import { applyEconomyTick } from "./EconomyEngine.js";
import { applyMarketTick } from "./MarketEngine.js";
import { processDriverNegotiations } from "./NegotiationEngine.js";
import { syncInbox } from "./InboxEngine.js";
import { tickAITechnicalWorld } from "./AITechnicalEngine.js";
import { processWorkshopJobs } from "../domain/componentService.js";
import { processPlayerTechnicalLifecycle } from "../domain/playerTechnicalLifecycle.js";
import { processTechnologyAdoption, processTechnologyDiscoveryNews } from "../domain/technologyAdoption.js";
import { advanceNextSeasonCarDay } from "../domain/nextSeasonCar.js";

function isState(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const DEFAULT_DAILY_TICK_STAGES = Object.freeze([
  { id: "events", run: (state) => triggerDailyTick(state) },
  { id: "scouting", run: (state) => processScoutingTick(state) },
  { id: "driver-availability", run: (state) => refreshDriverAvailability(state, state.currentDateISO) },
  { id: "workshop", run: (state) => processWorkshopJobs(state) },
  { id: "player-technical", run: (state) => processPlayerTechnicalLifecycle(state) },
  { id: "technology-adoption", run: (state) => processTechnologyAdoption(state) },
  { id: "ai-technical", run: (state) => tickAITechnicalWorld(state) },
  { id: "technology-news", run: (state) => processTechnologyDiscoveryNews(state) },
  { id: "rules", run: (state) => applyRulesTick(state) },
  { id: "progression", run: (state) => applyProgressionTick(state) },
  { id: "next-season-car", run: (state) => advanceNextSeasonCarDay(state) },
  { id: "economy", run: (state) => applyEconomyTick(state) },
  { id: "driver-market", run: (state) => applyMarketTick(state) },
  { id: "driver-negotiations", run: (state) => processDriverNegotiations(state) },
  { id: "inbox", run: (state) => syncInbox(state) },
]);

export const DAILY_TICK_STAGE_IDS = Object.freeze(DEFAULT_DAILY_TICK_STAGES.map((stage) => stage.id));

export class DailyTickPipelineError extends Error {
  constructor({ stage, dateISO, completedStages = [], cause }) {
    const message = cause?.message || String(cause || "Unknown daily tick error");
    super(`Daily tick failed at ${stage || "unknown"} on ${dateISO || "unknown date"}: ${message}`);
    this.name = "DailyTickPipelineError";
    this.stage = stage || "unknown";
    this.dateISO = dateISO || null;
    this.completedStages = [...completedStages];
    this.cause = cause;
  }
}

export function runDailyTickPipeline(state, { stages = DEFAULT_DAILY_TICK_STAGES } = {}) {
  if (!isState(state)) {
    throw new TypeError("runDailyTickPipeline requires a gameState object.");
  }

  const dateISO = String(state.currentDateISO || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new TypeError("runDailyTickPipeline requires gameState.currentDateISO.");
  }

  let next = state;
  const completedStages = [];

  for (const stage of stages) {
    const stageId = String(stage?.id || "unknown");
    if (typeof stage?.run !== "function") {
      throw new DailyTickPipelineError({
        stage: stageId,
        dateISO,
        completedStages,
        cause: new TypeError(`Daily tick stage ${stageId} has no run() function.`),
      });
    }

    try {
      const result = stage.run(next);
      if (!isState(result)) {
        throw new TypeError(`Daily tick stage ${stageId} did not return a gameState object.`);
      }
      next = result;
      completedStages.push(stageId);
    } catch (cause) {
      if (cause instanceof DailyTickPipelineError) throw cause;
      throw new DailyTickPipelineError({
        stage: stageId,
        dateISO,
        completedStages,
        cause,
      });
    }
  }

  return {
    state: next,
    completedStages,
    dateISO,
  };
}
