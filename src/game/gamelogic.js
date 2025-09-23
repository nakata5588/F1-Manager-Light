// src/game/gameLogic.js
import { pick, getYearNumber, extractGPYear, sameTeam, unexcel } from "@/utils/dataHelpers";

// Outras utilitárias que possas precisar
import { addDaysISO, clampISO, firstDayISO, gpDateISO, firstDefined } from "@/utils/dates";

// As funções que dependem da lógica do jogo
function computeDriverStatus(selectedYear, driver) {
  // ...
}

function activeInYear(entity, year) {
  // ...
}

function filterByYear(records, year) {
  // ...
}

function filterByYearRange(records, year) {
  // ...
}

function normalizeTeam(t) {
  // ...
}

// ... e outras funções de lógica de negócio ...

/** ===================== FILTRO POR ANO ===================== */
export function applyYearFilterLogic(state, year, opts = {}) {
  const { normalizeDate = true } = opts || {};
  const y = Number(year);

  // ... toda a tua lógica de filtragem
  // Usando as funções importadas como `filterByYear`, `pick`, etc.
  
  const nextState = {
    ...state,
    activeYear: y,
    // ... os teus arrays filtrados
  };

  return nextState;
}