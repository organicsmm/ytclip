import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Zap, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { openCheckout, type PlanId } from "@/lib/paddle";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  used: number;
  monthlyLimit: number;
  plan: "free" | "starter" | "pro";
}

const PLANS = [
  {
    id: "starter" as const,
    name: "Starter",
    price: 10,
    videos: 50,
    icon: Sparkles,
    features: ["50 viral clips / month", "All aspect ratios", "Subtitle styles", "Priority queue"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: 20,
    videos: 100,
    icon: Zap,
    highlight: true,
    features: ["100 viral clips / month", "Everything in Starter", "AI face tracking", "Email support"],
  },
];

export function UpgradeModal({ open, onOpenChange, used, monthlyLimit, plan }: Props) {
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const queryClient = useQueryClient();

  const handleUpgrade = async (target: PlanId) => {
    setLoadingPlan(target);
    try {
      const result = await openCheckout({
        plan: target,
        onComplete: () => {
          toast.success("Payment successful — welcome aboard!", {
            description: "Your plan is updating; this may take a few seconds.",
          });
          onOpenChange(false);
          // Webhook updates the subscriptions table; poll for a moment.
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ["quota"] }), 1500);
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ["quota"] }), 5000);
        },
        onClose: () => {
          toast.message("Checkout closed", { description: "No charge was made." });
        },
      });
      if (!result.ok) {
        toast.error("Couldn't open checkout", { description: result.reason });
      }
    } catch (e) {
      toast.error("Checkout failed", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoadingPlan(null);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl italic">
            You've hit your monthly limit
          </DialogTitle>
          <DialogDescription>
            You're on the <span className="font-semibold text-foreground">{plan}</span> plan
            ({used}/{monthlyLimit} videos used this month). Upgrade to keep generating clips.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {PLANS.map((p) => {
            const Icon = p.icon;
            const isCurrent = p.id === plan;
            return (
              <div
                key={p.id}
                className={`rounded-xl border p-5 ${
                  p.highlight ? "border-primary/60 bg-primary/5" : "border-border bg-surface/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="font-display text-xl">{p.name}</h3>
                  {p.highlight && (
                    <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                      Popular
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold">${p.price}</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{p.videos} videos per month</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  disabled={isCurrent || loadingPlan !== null}
                  className="btn-glow mt-5 h-11 w-full rounded-lg text-xs font-semibold uppercase tracking-[0.2em]"
                  onClick={() => handleUpgrade(p.id)}
                >
                  {loadingPlan === p.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…
                    </>
                  ) : isCurrent ? (
                    "Current plan"
                  ) : plan === "starter" && p.id === "pro" ? (
                    "Upgrade to Pro"
                  ) : (
                    `Upgrade to ${p.name}`
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Your quota resets on the 1st of every month.
        </p>
      </DialogContent>
    </Dialog>
  );
}
