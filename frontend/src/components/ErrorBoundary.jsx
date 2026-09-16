import { Component } from "react";

// Without this, any uncaught render-time error anywhere in the tree (a bad API
// response shape, a null a component didn't expect, etc.) unmounts the entire
// app to a blank white screen with no way back except a hard refresh — which
// also throws away any in-progress form state (e.g. a partially filled wizard)
// that wasn't already persisted. This catches it, shows a recoverable message,
// and lets the user retry without losing the rest of the app.

// TEMPORARY DIAGNOSTIC MODE — a real crash is happening in production for one
// specific account and we can't reproduce it locally. This renders the raw
// error message + component stack directly on screen (instead of only in the
// browser console) so it can be screenshotted without anyone needing to open
// devtools. Revert this block (put the plain friendly message back) once the
// bug behind it is found and fixed — this should not stay on in the long run.
const DIAGNOSTIC_MODE = true;

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error:", error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, info: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="ea-card ea-card-brand max-w-md p-6">
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">Something went wrong</div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            This section hit an unexpected error. Your work elsewhere in the app is safe — try again, or reload the page if the
            problem continues.
          </p>
          {DIAGNOSTIC_MODE && this.state.error && (
            <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-left dark:border-rose-900/50 dark:bg-rose-950/30">
              <div className="text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-400">
                Diagnostic detail — please screenshot this box
              </div>
              <pre className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-snug text-rose-800 dark:text-rose-300">
                {String(this.state.error?.message || this.state.error)}
                {this.state.error?.stack ? `\n\n${this.state.error.stack}` : ""}
                {this.state.info?.componentStack ? `\n\nComponent stack:${this.state.info.componentStack}` : ""}
              </pre>
            </div>
          )}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-brand-600 to-accent-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:from-brand-700 hover:to-accent-700"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
