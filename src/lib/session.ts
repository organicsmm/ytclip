import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

let pending: Promise<User> | null = null;

/**
 * Returns the current user, creating an anonymous Supabase session on first
 * use. All AutoCliper data (videos, clips, storage objects) is scoped to this
 * user via RLS, so we MUST have a session before touching the API.
 */
export async function ensureSessionUser(): Promise<User> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user;
  if (!pending) {
    pending = (async () => {
      const { data: signed, error } = await supabase.auth.signInAnonymously();
      pending = null;
      if (error || !signed.user) {
        throw new Error(error?.message || "Could not start an anonymous session");
      }
      return signed.user;
    })();
  }
  return pending;
}
