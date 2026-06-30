import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — AutoCliper" },
      { name: "description", content: "Sign in or create an AutoCliper account to start generating viral shorts." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
});

const signUpSchema = signInSchema.extend({
  displayName: z.string().trim().min(1, "Name is required").max(80),
});

function AuthPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Bounce home.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session?.user && !data.session.user.is_anonymous) {
        void navigate({ to: "/", replace: true });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user && !session.user.is_anonymous) {
        void navigate({ to: "/", replace: true });
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = signInSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);
    try {
      // Clear any leftover anonymous session before signing into a real account.
      await supabase.auth.signOut().catch(() => undefined);
      const { error } = await supabase.auth.signInWithPassword(parsed.data);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Welcome back!");
      void navigate({ to: "/", replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = signUpSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
      displayName: form.get("displayName"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setSubmitting(true);
    try {
      await supabase.auth.signOut().catch(() => undefined);
      const { error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { display_name: parsed.data.displayName },
        },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Account created — you're in!");
      void navigate({ to: "/", replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md items-center px-6 py-12">
      <div className="paper-card w-full p-8">
        <div className="mb-6 border-b border-[color:var(--color-ink)]/10 pb-4">
          <p className="eyebrow">Account</p>
          <h1 className="mt-2 font-display text-4xl italic leading-none text-[color:var(--color-ink)]">
            Welcome to AutoCliper
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to generate, save, and download your AI clips.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
          <TabsList className="grid w-full grid-cols-2 bg-surface/60">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="mt-5">
            <form onSubmit={handleSignIn} className="space-y-4">
              <Field id="signin-email" label="Email" name="email" type="email" autoComplete="email" required />
              <Field
                id="signin-password"
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
              <Button type="submit" disabled={submitting} className="btn-glow h-11 w-full rounded-lg text-sm font-semibold">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup" className="mt-5">
            <form onSubmit={handleSignUp} className="space-y-4">
              <Field id="signup-name" label="Display name" name="displayName" type="text" autoComplete="name" required />
              <Field id="signup-email" label="Email" name="email" type="email" autoComplete="email" required />
              <Field
                id="signup-password"
                label="Password (min 6 chars)"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              <Button type="submit" disabled={submitting} className="btn-glow h-11 w-full rounded-lg text-sm font-semibold">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function Field(props: {
  id: string;
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={props.id} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {props.label}
      </Label>
      <Input
        id={props.id}
        name={props.name}
        type={props.type}
        autoComplete={props.autoComplete}
        required={props.required}
        className="mt-2 h-11 border-border bg-surface/60"
      />
    </div>
  );
}
