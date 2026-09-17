import React from "react";

/**
 * Keeps entity/profile rendering failures isolated from the rest of the game.
 * A malformed legacy row should never take the whole React tree down.
 */
export default class EntityErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[EntityModal] render failed", error, info);
  }

  componentDidUpdate(prevProps) {
    const prevKey = `${prevProps.entity?.type || ""}:${prevProps.entity?.id || ""}:${prevProps.entity?.tab || ""}`;
    const nextKey = `${this.props.entity?.type || ""}:${this.props.entity?.id || ""}:${this.props.entity?.tab || ""}`;
    if (this.state.error && prevKey !== nextKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="p-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Não foi possível abrir este perfil</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              O registo contém dados incompatíveis com o perfil atual. O resto do jogo continua disponível.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {this.props.entity?.type || "entity"}: {String(this.props.entity?.id ?? "unknown")}
            </p>
          </div>
          <button
            type="button"
            onClick={this.props.onClose}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }
}
