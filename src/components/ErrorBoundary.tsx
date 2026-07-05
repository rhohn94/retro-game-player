// ErrorBoundary — the route-shell render-time safety net (W360,
// error-telemetry-design.md §"React: ErrorBoundary at the route shell").
// React's error-boundary contract requires a class component (there is no
// hook equivalent for getDerivedStateFromError/componentDidCatch). Mounted
// once in App.tsx wrapping the routed content area, so a throw in one screen
// shows this fallback in the main content region instead of an unmounted
// white screen, while the sidebar/shell chrome stays intact.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorNotice } from "./ErrorNotice";
import { recordFrontendError } from "../telemetry/errorTelemetry";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Renders `children` normally until one of them throws during render, then
 * shows a minimal fallback (message + reload affordance) instead. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    recordFrontendError("react-error-boundary", error.message, info.componentStack ?? undefined);
  }

  private handleReload = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorNotice>
          <p>Something went wrong: {this.state.error.message}</p>
          <button type="button" onClick={this.handleReload}>
            Reload
          </button>
        </ErrorNotice>
      );
    }
    return this.props.children;
  }
}
