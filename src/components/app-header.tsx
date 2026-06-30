import { Link, useRouterState } from "@tanstack/react-router";

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const navItem = (to: "/" | "/history", label: string) => {
    const active = pathname === to;
    return (
      <Link
        to={to}
        className={`relative inline-flex items-center px-1 py-1 text-xs font-medium uppercase tracking-[0.22em] transition-colors ${
          active ? "text-[color:var(--color-ink)]" : "text-foreground/55 hover:text-[color:var(--color-ink)]"
        }`}
      >
        {label}
        {active && (
          <span className="absolute -bottom-0.5 left-0 right-0 h-px bg-[color:var(--color-ink)]" />
        )}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--color-ink)]/10 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-12">
        <Link to="/" className="flex items-baseline gap-3">
          <span className="font-display text-2xl italic leading-none text-[color:var(--color-ink)]">
            AutoCliper
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-foreground/45 md:inline">
            Vertical Edit Engine — v.04
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navItem("/", "Dashboard")}
          {navItem("/history", "Archive")}
        </nav>

        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-700/70 opacity-60 pulse-dot" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-700" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">
            Systems Operational
          </span>
        </div>
      </div>
    </header>
  );
}
