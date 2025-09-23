import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useGame } from "./state/GameStore";
import { useEventStore } from "./state/EventStore"; // ⬅️ mantém
import HubLayout from "./layouts/HubLayout.jsx";

/* Entity system (modal + click bus) */
import EntityModalRoot from "./components/entity/EntityModalRoot.jsx";
import EntityClickBus from "./components/entity/EntityClickBus.jsx";
import { bindEntityDeepLinkOnce } from "./state/ModalStore.js";

/* Season: resumo + botão Start {nextYear} */
import SeasonSummaryModal from "./components/entity/SeasonSummaryModal.jsx";

/* UI: Toaster */
import { Toaster } from "./components/ui/Toaster.jsx";

/* Páginas */
import Academy from "./pages/Academy.jsx";
import AssetTest from "./pages/AssetTest.jsx";
import Board from "./pages/Board.jsx";
import CalendarPage from "./pages/CalendarPage.jsx";
import Development from "./pages/Development.jsx";
import Drivers from "./pages/Drivers.jsx";
import Finances from "./pages/Finances.jsx";
import Home from "./pages/Home.jsx";
import HQ from "./pages/HQ.jsx";
import Inbox from "./pages/Inbox.jsx";
import LoadGame from "./pages/LoadGame.jsx";
import MainMenu from "./pages/MainMenu.jsx";
import NewGame from "./pages/NewGame.jsx";
import CreateTeam from "./pages/CreateTeam.jsx";
import Scouting from "./pages/Scouting.jsx";
import Settings from "./pages/Settings.jsx";
import Staff from "./pages/Staff.jsx";
import Standings from "./pages/Standings.jsx";
import Team from "./pages/Team.jsx";
import Results from "./pages/Results.jsx"; // ✅ NOVO

import DebugToolbar from "@/components/dev/DebugToolbar";

/** Aplica a preferência de tema à <html> */
function ThemeBinder() {
  const uiTheme = useGame((s) => s.gameState?.settings?.uiTheme);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = uiTheme || "auto";
    if (uiTheme === "dark") el.classList.add("dark");
    else if (uiTheme === "light") el.classList.remove("dark");
    else {
      const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
      const apply = () => (mq?.matches ? el.classList.add("dark") : el.classList.remove("dark"));
      apply();
      mq?.addEventListener?.("change", apply);
      return () => mq?.removeEventListener?.("change", apply);
    }
  }, [uiTheme]);
  return null;
}

export default function App() {
  // Ativa deep-link (?e=driver:ID&tab=overview) uma ÚNICA vez
  useEffect(() => {
    const unbind = bindEntityDeepLinkOnce();
    return () => unbind?.();
  }, []);

  // 🔁 Carrega templates de eventos/news no arranque
  useEffect(() => {
    useEventStore.getState().loadTemplates().catch((e) => {
      console.error("[EventStore] loadTemplates failed:", e);
    });
  }, []);

  // 🔧 Liga ferramentas de developer só em ambiente de desenvolvimento
  const updateSettings = useGame((s) => s.updateSettings);
  useEffect(() => {
    try {
      if (import.meta?.env?.DEV) {
        updateSettings({ developer: { showDevTools: true, verboseLogs: true } });
      }
    } catch {
      // ambiente sem import.meta.env (no-ops)
    }
  }, [updateSettings]);

  return (
    <BrowserRouter>
      <ThemeBinder />

      {/* ==== Entity system (fora das Routes) ==== */}
      <EntityModalRoot />
      <EntityClickBus />

      {/* 🔔 Toaster global (feedback de ações, etc.) */}
      <Toaster />

      {/* 🧪 Toolbar de Debug (aparece se settings.developer.showDevTools === true) */}
      <DebugToolbar />

      {/* 🏁 Season Summary (abre quando o GameStore define showSeasonSummary=true) */}
      <SeasonSummaryModal />

      <Routes>
        {/* === Pré-jogo (SEM HubLayout) === */}
        <Route path="/" element={<MainMenu />} />
        <Route path="/NewGame" element={<NewGame />} />
        <Route path="/CreateTeam" element={<CreateTeam />} />
        <Route path="/LoadGame" element={<LoadGame />} />

        {/* === Jogo (COM HubLayout) === */}
        <Route element={<HubLayout />}>
          <Route path="/Home" element={<Home />} />
          <Route path="/Inbox" element={<Inbox />} />
          <Route path="/Drivers" element={<Drivers />} />
          <Route path="/Team" element={<Team />} />
          <Route path="/Standings" element={<Standings />} />
          <Route path="/Results" element={<Results />} /> {/* ✅ NOVO */}
          <Route path="/Settings" element={<Settings />} />
          <Route path="/CalendarPage" element={<CalendarPage />} />
          <Route path="/Development" element={<Development />} />
          <Route path="/HQ" element={<HQ />} />
          <Route path="/Finances" element={<Finances />} />
          <Route path="/Board" element={<Board />} />
          <Route path="/Scouting" element={<Scouting />} />
          <Route path="/Academy" element={<Academy />} />
          <Route path="/Staff" element={<Staff />} />
          <Route path="/AssetTest" element={<AssetTest />} />
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
