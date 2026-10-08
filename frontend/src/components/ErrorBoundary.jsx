import React from "react";

/**
 * Stops a rendering error in one part of a page from blanking everything around it.
 * Shows a short message with a retry instead; `resetKey` clears the error when it changes
 * (for example when the user switches tab).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the details for developers; customers see the plain message below.
    console.error(`[${this.props.label || "section"}] failed to render:`, error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
        <p className="font-semibold">
          {this.props.label ? `The ${this.props.label} section couldn't be displayed.` : "This section couldn't be displayed."}
        </p>
        <p className="mt-1 text-rose-700">Your data is safe, and the rest of the page still works.</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-100">
          Try again
        </button>
      </div>
    );
  }
}

/** Runs `render` inside its own component, so an error thrown while building that markup
 *  is caught by the nearest ErrorBoundary instead of by the whole page. */
export function Guarded({ render }) {
  return render();
}
