import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Quota = {
  plan: "free" | "starter" | "pro";
  status: string;
  used: number;
  monthly_limit: number;
  period_month: string;
  current_period_end: string | null;
  paddle_subscription_id: string | null;
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

export const getQuota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Quota> => {
    const { supabase } = context;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    
    if (!token) throw new Error("Unauthorized: missing access token");
    
    const res = await fetch(`${BACKEND_URL}/api/quota`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Backend error (${res.status}): ${errText}`);
    }
    return res.json() as Promise<Quota>;
  });


export const consumeVideoQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ allowed: boolean; used: number; monthly_limit: number }> => {
    // Quota consumption is handled automatically on backend /api/videos creation, 
    // so we return a dummy allowed=true response here as a frontend compatibility stub.
    return { allowed: true, used: 0, monthly_limit: 0 };
  });
