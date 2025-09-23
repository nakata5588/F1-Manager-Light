// src/state/EventStore.js
import { create } from "zustand";

/** Helpers */
function baseUrl() {
  return (import.meta?.env?.BASE_URL || "/").replace(/\/+$/, "/");
}
async function fetchJSONSafe(url) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} at ${url}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 120)}…`); }
}
async function tryUrls(urls) {
  let lastErr;
  for (const u of urls) {
    try { return await fetchJSONSafe(u); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All URLs failed");
}

/** Store */
export const useEventStore = create((set, get) => ({
  eventTemplates: [],
  newsTemplates: [],
  templatesError: null,
  loaded: false, // apenas 1 carregamento (sem anos)

  events: [],
  news: [],

  async loadTemplates() {
    if (get().loaded) return;

    const BASE = baseUrl();

    // ficheiros únicos em public/data/
    const eventUrls = [
      `${BASE}data/event_templates.json`,
      // tolerância a nomes “trocados” comuns
      `${BASE}data/events_templates.json`,
      `${BASE}data/event_template.json`,
    ];
    const newsUrls = [
      `${BASE}data/news_templates.json`,
      // fallback para o teu nome atual (singular)
      `${BASE}data/news_template.json`,
    ];

    try {
      const [eventTemplates, newsTemplates] = await Promise.all([
        tryUrls(eventUrls),
        tryUrls(newsUrls),
      ]);
      set({ eventTemplates, newsTemplates, templatesError: null, loaded: true });
    } catch (err) {
      console.error("[EventStore] loadTemplates failed:", err);
      set({ eventTemplates: [], newsTemplates: [], templatesError: String(err), loaded: false });
    }
  },

  resetTemplates() {
    set({ eventTemplates: [], newsTemplates: [], templatesError: null, loaded: false });
  },

  pushEvent(ev) { set((s) => ({ events: [...s.events, ev] })); },
  pushNews(nw)  { set((s) => ({ news:   [...s.news,   nw] })); },
}));
