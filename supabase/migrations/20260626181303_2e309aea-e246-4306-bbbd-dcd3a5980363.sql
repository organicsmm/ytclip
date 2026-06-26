
-- Allow public (anon) access to read/write the uploads and clips buckets so the
-- browser-only pipeline can upload sources and rendered clips.
DROP POLICY IF EXISTS "Public uploads bucket all" ON storage.objects;
DROP POLICY IF EXISTS "Public clips bucket all" ON storage.objects;

CREATE POLICY "Public uploads bucket all"
  ON storage.objects FOR ALL
  TO public
  USING (bucket_id = 'uploads')
  WITH CHECK (bucket_id = 'uploads');

CREATE POLICY "Public clips bucket all"
  ON storage.objects FOR ALL
  TO public
  USING (bucket_id = 'clips')
  WITH CHECK (bucket_id = 'clips');
