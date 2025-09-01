import React from "react";
import { useGame } from "../state/GameStore.js";
import NextGpCard from "../components/tiles/NextGpCard.jsx";
import CalendarSnapshot from "../components/tiles/CalendarSnapshot.jsx";
import TeamOverview from "../components/tiles/TeamOverview.jsx";
import InboxMini from "../components/tiles/InboxMini.jsx";

export default function Home() {
  const { gameState, setGameState } = useGame();
  const { currentDateISO, calendar = [], currentRound = 0, team, inbox = [] } = gameState;

  const next = calendar[currentRound];

  const advanceOneDay = () => {
    // avança data 1 dia (UTC safe para ISO)
    const [y, m, d] = currentDateISO.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    const nextISO = dt.toISOString().slice(0, 10);
    setGameState({ currentDateISO: nextISO });
  };

  const saveGame = () => {
    // mock de save local
    localStorage.setItem("f1hm_save", JSON.stringify(gameState));
    alert("Game saved locally.");
  };

  return (
    <div className="grid gap-4">
      <div className="grid md:grid-cols-3 gap-4">
        <NextGpCard currentDateISO={currentDateISO} gp={next} />
        <CalendarSnapshot calendar={calendar} currentRound={currentRound} />
        <TeamOverview team={team} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <InboxMini items={inbox} />
        <div className="md:col-span-1">
          {/* espaço para um futuro card (Drivers form, Weather, Board, etc.) */}
          <div className="bg-white rounded-xl shadow p-4 h-full">
            <h3 className="text-base font-semibold">Coming soon</h3>
            <p className="text-sm text-gray-600 mt-1">More widgets here.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
