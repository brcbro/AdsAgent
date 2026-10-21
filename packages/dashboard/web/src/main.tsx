import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./styles.css";
import { queryClient } from "./lib/queries";
import { TooltipProvider } from "./components/ui/tooltip";
import { ConfirmProvider } from "./components/ui/dialog";
import { ShellProvider } from "./components/shell/shell-context";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TooltipProvider>
            <ConfirmProvider>
              <ShellProvider>
                <App />
              </ShellProvider>
            </ConfirmProvider>
          </TooltipProvider>
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "!rounded-lg !border !border-line !bg-surface !text-fg !shadow-lg !font-sans",
              description: "!text-fg-muted",
            },
          }}
        />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
