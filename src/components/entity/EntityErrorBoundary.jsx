import React from "react";

/**
 * Keeps entity/profile rendering failures isolated from the rest of the game.
 * A malformed legacy row should never take the whole React tree down.
 */
export default class EntityErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[EntityModal] render failed", error, info);
    this.setState({ componentStack: info?.componentStack || "" });
  }

  componentDidUpdate(prevProps) {
    const prevKey = `${prevProps.entity?.type || ""}:${prevProps.entity?.id || ""}:${prevProps.entity?.tab || ""}`;
    const nextKey = `${this.props.entity?.type || ""}:${this.props.entity?.id || ""}:${this.props.entity?.tab || ""}`;
    if (this.state.error && prevKey !== nextKey) {
      this.setState({ error: null, componentStack: "" });
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
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <div className="font-semibold">Technical detail</div>
              <div className="mt-1 break-words font-mono">
                {String(this.state.error?.message || this.state.error || "Unknown profile render error")}
              </div>
              {this.state.componentStack ? (
                <details className="mt-2">
                  <summary className="cursor-pointer">Component stack</summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{this.state.componentStack}</pre>
                </details>
              ) : null}
            </div>
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
