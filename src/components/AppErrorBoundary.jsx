import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[App] unhandled render error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl">
          <h1 className="text-xl font-semibold">O jogo encontrou um erro inesperado</h1>
          <p className="mt-2 text-sm text-slate-300">
            A sessão não foi apagada. Recarrega a página para voltar ao último estado guardado.
          </p>
          <details className="mt-4 text-xs text-slate-400">
            <summary className="cursor-pointer">Detalhes técnicos</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap">{String(this.state.error?.message || this.state.error)}</pre>
          </details>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
