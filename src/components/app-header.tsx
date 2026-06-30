import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function AppHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const navItem = (to: "/" | "/history" | "/billing", label: string) => {
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

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    void router.navigate({ to: "/auth", replace: true });
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

        {signedIn && (
          <nav className="hidden items-center gap-8 md:flex">
            {navItem("/", "Dashboard")}
            {navItem("/history", "Archive")}
            {navItem("/billing", "Billing")}
          </nav>
        )}

        <div className="flex items-center gap-3">
          {signedIn && email && (
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55 md:inline">
              {email}
            </span>
          )}
          {signedIn ? (
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              <LogOut className="h-3 w-3" /> Sign out
            </button>
          ) : (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-700/70 opacity-60 pulse-dot" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-700" />
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
