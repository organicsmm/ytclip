
CREATE TABLE public.videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled video',
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'youtube',
  status TEXT NOT NULL DEFAULT 'processing',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress NUMERIC NOT NULL DEFAULT 0,
  log_lines TEXT[] NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.videos TO anon, authenticated;
GRANT ALL ON public.videos TO service_role;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read videos" ON public.videos FOR SELECT USING (true);
CREATE POLICY "Public insert videos" ON public.videos FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update videos" ON public.videos FOR UPDATE USING (true);
CREATE POLICY "Public delete videos" ON public.videos FOR DELETE USING (true);

CREATE TABLE public.clips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time NUMERIC NOT NULL,
  end_time NUMERIC NOT NULL,
  score NUMERIC NOT NULL DEFAULT 0,
  hook TEXT,
  video_url TEXT,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clips TO anon, authenticated;
GRANT ALL ON public.clips TO service_role;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read clips" ON public.clips FOR SELECT USING (true);
CREATE POLICY "Public insert clips" ON public.clips FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update clips" ON public.clips FOR UPDATE USING (true);
CREATE POLICY "Public delete clips" ON public.clips FOR DELETE USING (true);

CREATE INDEX clips_video_id_idx ON public.clips(video_id);
CREATE INDEX videos_created_at_idx ON public.videos(created_at DESC);

ALTER TABLE public.videos REPLICA IDENTITY FULL;
ALTER TABLE public.clips REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.videos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clips;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER videos_touch_updated_at
BEFORE UPDATE ON public.videos
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
