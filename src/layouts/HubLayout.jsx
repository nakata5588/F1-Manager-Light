import React, { useState, useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import { useGame } from "../state/GameStore.js";
import { fmtISO, daysBetween } from "../utils/date.js";
import { Button } from "../components/ui/button.jsx";

export default function HubLayout() {
  const { gameState, setGameState } = useGame();
  const { currentDateISO, calendar = [], currentRound = 0 } = gameState;

  const nextGp = calendar[currentRound] ?? null;
  const daysToNext = nextGp ? daysBetween(currentDateISO, nextGp.dateISO) : null;

  // simulação (play/pause + speed)
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const tick = useRef(null);

  const advanceOneDay = () => {
    const [y, m, d] = currentDateISO.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    const nextISO = dt.toISOString().slice(0, 10);
    setGameState({ currentDateISO: nextISO });
  };

  useEffect(() => {
    clearInterval(tick.current);
    if (!running) return;
    const ms = speed === 1 ? 900 : speed === 2 ? 450 : 225;
    tick.current = setInterval(advanceOneDay, ms);
    return () => clearInterval(tick.current);
  }, [running, speed, currentDateISO]);

  const saveGame = () => {
    localStorage.setItem("f1hm_save", JSON.stringify(gameState));
    alert("Game saved.");
  };

  return (
    <div className="min-h-screen flex bg-gray-100">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="bg-white border-b">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
            <h1 className="text-lg font-semibold">F1 History Manager</h1>

            <div className="text-sm text-gray-700">
              <div className="font-medium">
                Next GP{nextGp ? ` — ${nextGp.name}` : ""}{" "}
                {daysToNext !== null ? `• in ${daysToNext} days` : ""}
              </div>
              <div className="text-xs text-gray-500">
                {nextGp ? fmtISO(nextGp.dateISO) : "TBD"}
              </div>
            </div>

            <div className="ml-auto flex gap-2">
              <Button onClick={advanceOneDay}>+1 day</Button>
              <Button onClick={() => setRunning((r) => !r)}>
                {running ? "Pause" : "Play"}
              </Button>
              <Button onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}>
                x{speed}
              </Button>
              <Button onClick={saveGame} className="bg-gray-800">Save</Button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1">
          <div className="max-w-6xl mx-auto px-4 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
