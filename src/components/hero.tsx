import { Zap, Wand2, Scissors } from "lucide-react";

export function Hero() {
  return (
    <div className="relative overflow-hidden rounded-3xl glass-card px-8 py-12 sm:px-12 sm:py-16">
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-primary-glow/15 blur-3xl" />

      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-primary">
          <Zap className="h-3 w-3" /> ai-powered · cloud rendered
        </div>
        <h1 className="mt-5 max-w-3xl font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Turn long videos into <span className="text-gradient">scroll-stopping shorts</span>.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Drop a YouTube link or upload a file. Skate AI transcribes it, ranks the most engaging
          moments, crops to vertical, and burns in animated subtitles — ready to post.
        </p>

        <div className="mt-8 flex flex-wrap gap-6 text-xs text-muted-foreground">
          <Feature Icon={Wand2} label="AI-ranked hooks" />
          <Feature Icon={Scissors} label="Auto 9:16 crop" />
          <Feature Icon={Zap} label="Burned-in subtitles" />
        </div>
      </div>
    </div>
  );
}

function Feature({ Icon, label }: { Icon: typeof Zap; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      <span className="font-medium text-foreground">{label}</span>
    </span>
  );
}
