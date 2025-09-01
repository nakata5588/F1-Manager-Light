// src/state/GameStore.js
import { create } from "zustand";

/** Onde vamos guardar o "save" local (opcional) */
const SAVE_KEY = "f1hm_save";

/** Helper para ler JSON com erro legível na consola */
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} — HTTP ${res.status}`);
  }
  return res.json();
}

export const useGame = create((set, get) => ({
  // ====== ESTADO INICIAL ======
  gameState: {
    currentDateISO: "1980-01-01",
    currentRound: 0,

    // “BD” carregada por loadData()
    calendar: [],
    drivers: [],
    teams: [],

    // podes trocar isto por dados vindos da BD quando quiseres
    team: null,
    standings: { drivers: [], teams: [] },
    inbox: [],
  },

  // ====== AÇÕES GERAIS ======
  /** Faz merge no gameState (sem perder o resto) */
  setGameState: (partial) =>
    set((s) => ({ gameState: { ...s.gameState, ...partial } })),

  /** Avança 1 dia (UTC-safe) — útil se quiseres chamar de outros sítios */
  advanceOneDay: () => {
    const { currentDateISO } = get().gameState;
    const [y, m, d] = currentDateISO.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    const nextISO = dt.toISOString().slice(0, 10);
    set((s) => ({ gameState: { ...s.gameState, currentDateISO: nextISO } }));
  },

  // ====== CARREGAR “BASE DE DADOS” ======
  /**
   * Carrega drivers, calendar e teams de /public/data/.
   * Se os ficheiros não existirem, mantém listas vazias e faz log do erro.
   */
  loadData: async () => {
    try {
      const [drivers, calendar, teams] = await Promise.all([
        fetchJson("/data/drivers.json"),
        fetchJson("/data/calendar.json"),
        fetchJson("/data/teams.json"),
      ]);

      set((s) => ({
        gameState: {
          ...s.gameState,
          drivers,
          calendar,
          teams,

          // valores default “de arranque” (troca quando ligares à BD real)
          team: s.gameState.team ?? { name: "McLaren", budget: 12000000 },
          inbox:
            s.gameState.inbox.length > 0
              ? s.gameState.inbox
              : [
                  {
                    id: 1,
                    subject: "Tyre allocation confirmed",
                    from: "FIA",
                    tag: "FIA",
                    date: "1980-01-05",
                  },
                  {
                    id: 2,
                    subject: "Sponsor meeting recap",
                    from: "Commercial",
                    tag: "Sponsors",
                    date: "1980-01-03",
                  },
                ],
        },
      }));
    } catch (err) {
      console.error("loadData() failed:", err);
      // Mantém a UI viva com listas vazias; nada explode.
    }
  },

  // ====== SAVE / LOAD (LOCALSTORAGE) — opcional ======
  /** Guarda o estado atual no localStorage */
  saveLocal: () => {
    try {
      const state = get().gameState;
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error("saveLocal() failed:", e);
      return false;
    }
  },

  /** Lê um save do localStorage e aplica ao estado */
  loadLocal: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      set(() => ({ gameState: saved }));
      return true;
    } catch (e) {
      console.error("loadLocal() failed:", e);
      return false;
    }
  },
}));
