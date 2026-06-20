import * as React from "react";

import { Button } from "@/ui";

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

/** Root error boundary. Catches render crashes and offers a reload. */
export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="grid h-screen w-screen place-items-center bg-cg-editor p-6">
        <div className="grid max-w-[420px] gap-3 rounded-[10px] border border-cg-border bg-cg-surface p-5 text-center">
          <h1 className="m-0 text-[18px] font-[600] leading-tight tracking-[-0.01em] text-cg-fg">
            Something went wrong
          </h1>
          <p className="m-0 text-[12.5px] leading-relaxed text-cg-muted">
            Bio Eng Studio hit an unexpected error. Reloading usually fixes it;
            your work is saved locally.
          </p>
          <div className="flex justify-center">
            <Button onClick={() => window.location.reload()} size="sm">
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
