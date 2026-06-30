
-- 1. Add ownership column to videos
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Add ownership column to clips
ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Backfill clips.user_id from parent video where missing
UPDATE public.clips c
SET user_id = v.user_id
FROM public.videos v
WHERE c.video_id = v.id AND c.user_id IS NULL AND v.user_id IS NOT NULL;

-- 4. Drop the existing permissive policies on videos
DROP POLICY IF EXISTS "Public read videos" ON public.videos;
DROP POLICY IF EXISTS "Public insert videos" ON public.videos;
DROP POLICY IF EXISTS "Public update videos" ON public.videos;
DROP POLICY IF EXISTS "Public delete videos" ON public.videos;

-- 5. Drop the existing permissive policies on clips
DROP POLICY IF EXISTS "Public read clips" ON public.clips;
DROP POLICY IF EXISTS "Public insert clips" ON public.clips;
DROP POLICY IF EXISTS "Public update clips" ON public.clips;
DROP POLICY IF EXISTS "Public delete clips" ON public.clips;

-- 6. Replace anon grants with authenticated-only
REVOKE ALL ON public.videos FROM anon;
REVOKE ALL ON public.clips FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.videos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clips TO authenticated;
GRANT ALL ON public.videos TO service_role;
GRANT ALL ON public.clips TO service_role;

-- 7. Owner-scoped policies on videos
CREATE POLICY "Owners read their videos"
  ON public.videos FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owners insert their videos"
  ON public.videos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners update their videos"
  ON public.videos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners delete their videos"
  ON public.videos FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 8. Owner-scoped policies on clips
CREATE POLICY "Owners read their clips"
  ON public.clips FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owners insert their clips"
  ON public.clips FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners update their clips"
  ON public.clips FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners delete their clips"
  ON public.clips FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 9. Storage policies: drop existing permissive policies for our buckets
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- 10. Owner-scoped storage policies for uploads + clips buckets
-- Path convention enforced by the app: <user_id>/<video_id>/<filename>
CREATE POLICY "Owners read uploads"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Owners write uploads"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Owners update uploads"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Owners delete uploads"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Owners read clips"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Owners write clips"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Owners update clips"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Owners delete clips"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
