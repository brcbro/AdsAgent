import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw, ServerCrash } from "lucide-react";
import { Button } from "../ui/button";

/** Last-resort screen for render errors, with a retry and a details disclosure. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorScreen
        title="Something went wrong"
        description="The studio hit an unexpected error. Your saved projects are not affected."
        details={this.state.error.stack ?? this.state.error.message}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

export function ErrorScreen({ title, description, details, onRetry, offline }:
  { title: string; description: string; details?: string; onRetry: () => void; offline?: boolean }) {
  return (
    <div className="grid min-h-full place-items-center bg-bg p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-md animate-fade-in">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-danger-subtle text-danger">
          {offline ? <ServerCrash className="size-6" /> : <AlertTriangle className="size-6" />}
        </div>
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        <p className="mt-2 text-sm text-fg-muted">{description}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={onRetry}><RotateCw /> Try again</Button>
          <Button variant="secondary" onClick={() => window.location.assign("/studio")}>Go to Studio</Button>
        </div>
        {details && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs font-medium text-fg-muted hover:text-fg">Technical details</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-subtle p-3 text-xs whitespace-pre-wrap text-fg-secondary">{details}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
