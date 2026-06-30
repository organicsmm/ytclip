import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { AppHeader } from "@/components/app-header";
import { supabase } from "@/integrations/supabase/client";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-card max-w-md rounded-2xl px-10 py-12 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">404</p>
        <h1 className="mt-3 text-3xl font-semibold text-gradient">Lost in the timeline</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          That clip got cut from the reel. Head back to the dashboard.
        </p>
        <Link
          to="/"
          className="btn-glow mt-6 inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium"
        >
          Back to AutoCliper
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-card max-w-md rounded-2xl px-10 py-12 text-center">
        <h1 className="text-xl font-semibold text-foreground">The pipeline crashed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong rendering this view. Try again, or head home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-glow inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface/40 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Skate AI — Turn Long Videos Into Viral Shorts" },
      {
        name: "description",
        content:
          "AutoCliper transcribes, ranks, and renders the most engaging moments from any long-form video into vertical shorts — no install required.",
      },
      { name: "author", content: "AutoCliper" },
      { property: "og:title", content: "Skate AI — Turn Long Videos Into Viral Shorts" },
      {
        property: "og:description",
        content:
          "Paste a YouTube link, get AI-ranked vertical shorts with burned-in subtitles in minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@AutoCliper" },
      { name: "twitter:title", content: "Skate AI — Turn Long Videos Into Viral Shorts" },
      { name: "description", content: "Clip Crafter is an AI-powered web app that automatically creates viral video shorts from long-form content." },
      { property: "og:description", content: "Clip Crafter is an AI-powered web app that automatically creates viral video shorts from long-form content." },
      { name: "twitter:description", content: "Clip Crafter is an AI-powered web app that automatically creates viral video shorts from long-form content." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/180afd75-788a-43ef-822a-262c325ba77e/id-preview-50da15f5--a82efefa-5ab9-401d-80b8-d28c688dae7f.lovable.app-1782799916281.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/180afd75-788a-43ef-822a-262c325ba77e/id-preview-50da15f5--a82efefa-5ab9-401d-80b8-d28c688dae7f.lovable.app-1782799916281.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const user = data.session?.user;
      setSignedIn(Boolean(user && !user.is_anonymous));
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      const user = session?.user;
      setSignedIn(Boolean(user && !user.is_anonymous));
      void router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router, queryClient]);

  const isAuthRoute = pathname === "/auth";

  useEffect(() => {
    if (!authChecked) return;
    if (!signedIn && !isAuthRoute) {
      void router.navigate({ to: "/auth", replace: true });
    }
  }, [authChecked, signedIn, isAuthRoute, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen">
        {!isAuthRoute && <AppHeader signedIn={signedIn} />}
        {authChecked && (signedIn || isAuthRoute) ? <Outlet /> : <AuthLoading />}
        <Toaster theme="light" position="bottom-right" />
      </div>
    </QueryClientProvider>
  );
}

function AuthLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/40 border-t-primary" />
    </div>
  );
}

