import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, Video as VideoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VideoRow } from "@/lib/skate-types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — Skate AI" },
      {
        name: "description",
        content: "Browse your past Skate AI runs and reload generated viral shorts in one click.",
      },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("videos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setVideos((data ?? []) as VideoRow[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">history.log</p>
        <h1 className="mt-2 text-4xl font-bold text-gradient">Past Runs</h1>
        <p className="mt-2 text-muted-foreground">
          Every video you've pushed through the Skate pipeline. Click any run to reload its clips.
        </p>
      </div>

      {loading ? (
        <div className="glass-card animate-pulse rounded-2xl p-10 text-center text-muted-foreground">
          Loading run history…
        </div>
      ) : videos.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <VideoIcon className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-4 text-lg font-medium">No runs yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit your first video on the dashboard to get started.
          </p>
          <Link
            to="/"
            className="btn-glow mt-6 inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium"
          >
            Go to Dashboard
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {videos.map((v) => (
            <li key={v.id}>
              <Link
                to="/"
                search={{ video: v.id } as never}
                className="glass-card group flex items-center justify-between rounded-xl px-5 py-4 transition-all hover:border-primary/40 hover:shadow-glow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-display text-base font-semibold">{v.title}</h3>
                    <StatusBadge status={v.status} />
                  </div>
                  <p className="mt-1 flex items-center gap-3 truncate font-mono text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {new Date(v.created_at).toLocaleString()}
                    </span>
                    {v.source_url && <span className="truncate">{v.source_url}</span>}
                  </p>
                </div>
                <div className="ml-4 shrink-0 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Load →
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    processing: "bg-warning/15 text-warning border-warning/30",
    completed: "bg-success/15 text-success border-success/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase ${map[status] ?? ""}`}>
      {status}
    </Badge>
  );
}
