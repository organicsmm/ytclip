import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

/**
 * Returns the current signed-in Supabase user, or throws if there is no
 * authenticated (non-anonymous) session. The app gates all data access
 * through a real account — callers must redirect to /auth on failure.
 */
export async function ensureSessionUser(): Promise<User> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) {
    throw new Error("Not signed in");
  }
  return user;
}
