import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error("The password did not create a session.");
  return data.session;
}

export async function setAccountPassword(password: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
  });
  if (error?.code === "over_email_send_rate_limit")
    throw new Error("No email was sent. Too many sign-in links were requested; wait about an hour after the last email, then try once.");
  if (error) throw error;
}

export function parseSignInLink(link: string, projectUrl = url): string {
  if (!projectUrl) throw new Error("Supabase is not configured.");
  let pasted: URL;
  try { pasted = new URL(link.trim()); }
  catch { throw new Error("Paste the complete sign-in link from your email."); }
  if (pasted.origin !== new URL(projectUrl).origin || pasted.pathname !== "/auth/v1/verify" ||
      pasted.searchParams.get("type") !== "magiclink") {
    throw new Error("That is not a Noted sign-in link.");
  }
  const tokenHash = pasted.searchParams.get("token_hash") ?? pasted.searchParams.get("token");
  if (!tokenHash) throw new Error("The sign-in link is missing its token.");
  return tokenHash;
}

export async function verifyEmailLink(link: string): Promise<Session> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: parseSignInLink(link), type: "magiclink" });
  if (error?.code === "otp_expired")
    throw new Error("That link has expired or was already used. Request a new email, then copy its link without opening it first.");
  if (error) throw error;
  if (!data.session) throw new Error("The link did not create a session.");
  return data.session;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}
