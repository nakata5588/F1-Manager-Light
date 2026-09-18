import { Fragment, useMemo } from "react";
import ActionsButton from "../ui/ActionsButton.jsx";
import { Dumbbell, Megaphone, Wrench, Handshake, Search, FileText, Coffee, MessageSquare } from "lucide-react";
import { useGame } from "../../state/GameStore.js";

export default function DriverActionsMenu({ driver, isOwnDriver, label = "Actions" }) {
  const queueEvent = useGame.getState().queueEvent;
  const currentDate = useGame.getState().gameState?.currentDate;

  const groups = useMemo(() => {
    if (isOwnDriver) {
      return [
        {
          title: "Training & Development",
          items: [
            { key: "sim_braking", icon: <Dumbbell size={16} />, label: "Simulator — Braking focus", effects: [
              { key: "driver_attr", driverId: driver?.driver_id, attr: "consistency", delta: +1 },
              { key: "fatigue", delta: +2 },
            ]},
            { key: "fitness", icon: <Dumbbell size={16} />, label: "Physical training", effects: [
              { key: "driver_attr", driverId: driver?.driver_id, attr: "mentality", delta: +1 },
              { key: "fatigue", delta: +3 },
            ]},
            { key: "data_review", icon: <Wrench size={16} />, label: "Data review w/ engineers", effects: [
              { key: "team_synergy", delta: +1 },
            ]},
          ],
        },
        {
          title: "Media & PR",
          items: [
            { key: "sponsor_event", icon: <Megaphone size={16} />, label: "Sponsor activation", effects: [] },
            { key: "tv_interview", icon: <Megaphone size={16} />, label: "TV interview", effects: [] },
            { key: "media_training", icon: <MessageSquare size={16} />, label: "Media training", effects: [] },
          ],
        },
        {
          title: "Wellbeing & Admin",
          items: [
            { key: "rest_day", icon: <Coffee size={16} />, label: "Rest day", effects: [
              { key: "fatigue", delta: -3 },
            ]},
            { key: "contract_talk", icon: <FileText size={16} />, label: "Contract talk", effects: [] },
          ],
        },
      ];
    }
    // Outros pilotos (mercado)
    return [
      {
        title: "Scouting & Info",
        items: [
          { key: "scout_watch", icon: <Search size={16} />, label: "Observe performance", effects: [] },
          { key: "agent_probe", icon: <Handshake size={16} />, label: "Approach agent", effects: [] },
          { key: "private_test_offer", icon: <Search size={16} />, label: "Offer private test", effects: [] },
        ],
      },
      {
        title: "Market Actions",
        items: [
          { key: "open_negotiation", icon: <Handshake size={16} />, label: "Open negotiations", effects: [] },
          { key: "networking_event", icon: <Handshake size={16} />, label: "Networking at event", effects: [] },
        ],
      },
      {
        title: "Media",
        items: [
          { key: "press_comment", icon: <Megaphone size={16} />, label: "Comment to press", effects: [] },
          { key: "rumor_check", icon: <Search size={16} />, label: "Investigate rumors", effects: [] },
        ],
      },
    ];
  }, [isOwnDriver, driver?.driver_id]);

  function onPick(it) {
    queueEvent({
      type: isOwnDriver ? "driver_action" : "market_action",
      title: it.label,
      date: currentDate, // processa hoje (altera aqui se quiseres processar “amanhã”)
      participants: [driver?.driver_id],
      effects: it.effects || [],
      meta: { uiKey: it.key, driverId: driver?.driver_id },
    });
    // (opcional) mostrar toast/feedback
    // useToast(`${it.label} queued for ${driver?.display_name}`);
  }

  return (
    <ActionsButton label={label}>
      <div className="p-2">
        {groups.map((g) => (
          <Fragment key={g.title}>
            <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{g.title}</p>
            <ul className="mb-1">
              {g.items.map((it) => (
                <li key={it.key}>
                  <button
                    type="button"
                    onClick={() => onPick(it)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-zinc-800"
                  >
                    <span className="mt-0.5 shrink-0">{it.icon}</span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{it.label}</span>
                      {it.desc && <span className="block text-xs text-gray-500 dark:text-gray-400">{it.desc}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="my-2 h-px w-full bg-gray-100 dark:bg-zinc-800" />
          </Fragment>
        ))}
        <div className="px-2 pb-2 text-[11px] text-gray-400">Tips: ações podem ter custos/benefícios.</div>
      </div>
    </ActionsButton>
  );
}
