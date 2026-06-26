import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, History, Sparkles } from "lucide-react";

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const navItem = (to: "/" | "/history", label: string, Icon: typeof History) => {
    const active = pathname === to;
    return (
      <Link
        to={to}
        className={`group inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
          active
            ? "bg-primary/15 text-foreground"
            : "text-muted-foreground hover:bg-surface hover:text-foreground"
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl btn-glow">
            <Sparkles className="h-4.5 w-4.5" strokeWidth={2.5} />
          </span>
          <div className="leading-none">
            <div className="font-display text-lg font-bold tracking-tight">
              Skate <span className="text-gradient">AI</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              viral shorts engine
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItem("/", "Dashboard", Sparkles)}
          {navItem("/history", "History", History)}
        </nav>

        <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 pulse-dot" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-success">
            <Activity className="mr-1 inline h-3 w-3" />
            api online
          </span>
        </div>
      </div>
    </header>
  );
}
