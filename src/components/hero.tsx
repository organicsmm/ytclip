export function Hero() {
  return (
    <section className="border-b border-[color:var(--color-ink)]/10 pb-10">
      <div className="grid gap-10 md:grid-cols-12 md:items-end">
        <div className="md:col-span-8">
          <p className="eyebrow">Issue 04 · Vertical Storytelling</p>
          <h1 className="mt-4 font-display text-[64px] leading-[0.95] tracking-tight text-[color:var(--color-ink)] sm:text-[84px] md:text-[112px]">
            From long-form depth
            <br />
            to <span className="italic">vertical impact.</span>
          </h1>
        </div>
        <div className="md:col-span-4">
          <p className="max-w-sm text-base leading-relaxed text-foreground/75 md:text-[17px]">
            Paste a link or upload a file. Skate AI transcribes, ranks the most engaging moments,
            crops to vertical, and burns in animated subtitles — ready to post.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/55">
            <span>01 · AI-ranked hooks</span>
            <span>02 · Auto 9:16 crop</span>
            <span>03 · Burned-in subtitles</span>
          </div>
        </div>
      </div>
    </section>
  );
}
