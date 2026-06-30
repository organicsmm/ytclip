import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Quota = {
  plan: "free" | "starter" | "pro";
  status: string;
  used: number;
  monthly_limit: number;
  period_month: string;
};

export const getQuota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Quota> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("get_user_quota", { _user_id: userId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      plan: row?.plan ?? "free",
      status: row?.status ?? "active",
      used: Number(row?.used ?? 0),
      monthly_limit: Number(row?.monthly_limit ?? 3),
      period_month: String(row?.period_month ?? ""),
    };
  });

export const consumeVideoQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ allowed: boolean; used: number; monthly_limit: number }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("increment_video_usage", { _user_id: userId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed),
      used: Number(row?.used ?? 0),
      monthly_limit: Number(row?.monthly_limit ?? 0),
    };
  });
