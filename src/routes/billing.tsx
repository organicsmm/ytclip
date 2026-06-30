import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getQuota } from "@/lib/billing.functions";
import { UpgradeModal } from "@/components/upgrade-modal";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Zap, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/billing")({
  head: () => ({
    meta: [
      { title: "Billing & Usage — AutoCliper" },
      {
        name: "description",
        content: "View your current AutoCliper plan and monthly clip usage.",
      },
    ],
  }),
  component: BillingPage,
});

const PLAN_COPY = {
  free: { name: "Free", price: 0, icon: ShieldCheck },
  starter: { name: "Starter", price: 10, icon: Sparkles },
  pro: { name: "Pro", price: 20, icon: Zap },
} as const;

function BillingPage() {
  const fetchQuota = useServerFn(getQuota);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["quota"],
    queryFn: () => fetchQuota(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="paper-card p-8">
          <h1 className="font-display text-3xl italic">Couldn't load billing</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <Button onClick={() => refetch()} className="mt-4">
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const planInfo = PLAN_COPY[data.plan];
  const Icon = planInfo.icon;
  const pct = Math.min(100, (data.used / Math.max(1, data.monthly_limit)) * 100);
  const remaining = Math.max(0, data.monthly_limit - data.used);
  const exhausted = remaining === 0;
  const isPaid = data.plan !== "free";

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        used={data.used}
        monthlyLimit={data.monthly_limit}
        plan={data.plan}
      />

      <div className="mb-8 flex items-end justify-between border-b border-[color:var(--color-ink)]/10 pb-5">
        <div>
          <p className="eyebrow">Step 04 · Account</p>
          <h1 className="mt-2 font-display text-5xl italic leading-none text-[color:var(--color-ink)]">
            Billing & Usage
          </h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
        >
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <section className="paper-card p-8">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-3">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">
                Current plan
              </p>
              <h2 className="mt-1 font-display text-3xl">{planInfo.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                ${planInfo.price}/month · {data.monthly_limit} videos per month
              </p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-foreground/55">
                Status: <span className="text-foreground">{data.status}</span>
              </p>
            </div>
          </div>
          <Button
            onClick={() => setUpgradeOpen(true)}
            className="btn-glow h-11 rounded-lg px-5 text-xs font-semibold uppercase tracking-[0.2em]"
          >
            {isPaid ? "Change plan" : "Upgrade"}
          </Button>
        </div>

        <div className="mt-8 border-t border-border/60 pt-6">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">This month's usage</p>
            <p className="font-mono text-sm tabular-nums">
              <span className={exhausted ? "font-semibold text-destructive" : "text-foreground"}>
                {data.used}
              </span>
              <span className="text-foreground/40"> / {data.monthly_limit} videos</span>
            </p>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--color-ink)]/10">
            <div
              className={`h-full transition-all ${exhausted ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">
            <span>
              {exhausted
                ? "Quota exhausted — upgrade to keep generating"
                : `${remaining} videos remaining`}
            </span>
            <span>Resets on the 1st</span>
          </div>
        </div>
      </section>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Need help with a charge? Email{" "}
        <a href="mailto:support@autocliper.com" className="text-primary hover:underline">
          support@autocliper.com
        </a>
        .
      </p>
    </main>
  );
}
