// src/core/season.js

/**
 * Função P U R A: recebe o estado atual e devolve o estado preparado
 * para a nova época (reset standings, inbox kickoff, histórico, etc.)
 */
export function rolloverSeasonPure(state, nextYear) {
  const prevYear =
    Number(state?.activeYear ?? state?.seasonYear ?? state?.season ?? nextYear - 1);

  // histórico de temporadas
  const historySeasons = Array.isArray(state.historySeasons)
    ? state.historySeasons.slice()
    : [];
  historySeasons.push({
    year: prevYear,
    standings: state.standings || { drivers: [], teams: [] },
    team_id: state?.team?.team_id ?? state?.team?.id ?? null,
    cash_end: state?.finances?.balance ?? null,
  });

  // mensagem de arranque
  const kickoff = {
    id: `preseason_${nextYear}`,
    date: `${nextYear}-01-02`,
    from: "Board",
    tag: "Season",
    subject: `Welcome to ${nextYear}`,
    body: "Pre-season has started. Review contracts, testing and facilities.",
  };

  return {
    ...state,
    activeYear: nextYear,
    currentDateISO: `${nextYear}-01-01`,
    currentRound: 0,
    standings: { drivers: [], teams: [] },
    lastSeason: prevYear,
    historySeasons,
    inbox: [kickoff, ...(state.inbox || [])],

    // flags internas
    _seasonFinishedAt: null,
    showSeasonSummary: false, // o modal é aberto pelo GameStore quando acaba a época
  };
}
