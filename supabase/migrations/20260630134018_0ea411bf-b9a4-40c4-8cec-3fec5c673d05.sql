
CREATE TYPE public.app_plan AS ENUM ('free', 'starter', 'pro');

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan public.app_plan NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  paddle_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_month date NOT NULL,
  videos_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month)
);
GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their usage" ON public.usage_counters
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.plan_limit(_plan public.app_plan)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _plan
    WHEN 'pro' THEN 100
    WHEN 'starter' THEN 50
    ELSE 3
  END
$$;

CREATE OR REPLACE FUNCTION public.get_user_quota(_user_id uuid)
RETURNS TABLE(plan public.app_plan, status text, used integer, monthly_limit integer, period_month date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _plan public.app_plan := 'free';
  _status text := 'active';
  _used integer := 0;
  _period date := date_trunc('month', now())::date;
BEGIN
  SELECT s.plan, s.status INTO _plan, _status
    FROM public.subscriptions s WHERE s.user_id = _user_id;
  IF NOT FOUND THEN _plan := 'free'; _status := 'active'; END IF;
  IF _status NOT IN ('active','trialing') THEN _plan := 'free'; END IF;
  SELECT u.videos_used INTO _used
    FROM public.usage_counters u
    WHERE u.user_id = _user_id AND u.period_month = _period;
  IF _used IS NULL THEN _used := 0; END IF;
  RETURN QUERY SELECT _plan, _status, _used, public.plan_limit(_plan), _period;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_video_usage(_user_id uuid)
RETURNS TABLE(allowed boolean, used integer, monthly_limit integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _plan public.app_plan := 'free';
  _status text := 'active';
  _period date := date_trunc('month', now())::date;
  _limit integer;
  _used integer := 0;
BEGIN
  SELECT s.plan, s.status INTO _plan, _status
    FROM public.subscriptions s WHERE s.user_id = _user_id;
  IF NOT FOUND OR _status NOT IN ('active','trialing') THEN _plan := 'free'; END IF;
  _limit := public.plan_limit(_plan);

  INSERT INTO public.usage_counters (user_id, period_month, videos_used)
  VALUES (_user_id, _period, 0)
  ON CONFLICT (user_id, period_month) DO NOTHING;

  SELECT u.videos_used INTO _used
    FROM public.usage_counters u
    WHERE u.user_id = _user_id AND u.period_month = _period
    FOR UPDATE;

  IF _used >= _limit THEN
    RETURN QUERY SELECT false, _used, _limit;
    RETURN;
  END IF;

  UPDATE public.usage_counters
    SET videos_used = videos_used + 1, updated_at = now()
    WHERE user_id = _user_id AND period_month = _period
    RETURNING videos_used INTO _used;

  RETURN QUERY SELECT true, _used, _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_quota(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_video_usage(uuid) TO authenticated, service_role;

CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER usage_counters_touch BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
