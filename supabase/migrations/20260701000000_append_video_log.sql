-- Migration to append video logs atomically
CREATE OR REPLACE FUNCTION public.append_video_log(_video_id uuid, _line text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.videos
  SET log_lines = array_append(log_lines, _line)
  WHERE id = _video_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_video_log(uuid, text) TO authenticated, service_role;

-- Refined function to upsert subscriptions from Paddle Webhook without needing service_role key
CREATE OR REPLACE FUNCTION public.handle_paddle_webhook_subscription(
  _user_id uuid,
  _plan public.app_plan,
  _status text,
  _paddle_sub_id text,
  _period_end timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, paddle_subscription_id, current_period_end, updated_at)
  VALUES (_user_id, _plan, _status, _paddle_sub_id, _period_end, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    plan = EXCLUDED.plan,
    status = EXCLUDED.status,
    paddle_subscription_id = EXCLUDED.paddle_subscription_id,
    current_period_end = EXCLUDED.current_period_end,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_paddle_webhook_subscription(uuid, public.app_plan, text, text, timestamptz) TO anon, authenticated, service_role;
