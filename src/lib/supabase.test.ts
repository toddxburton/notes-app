import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithOtp } }),
}));

describe("email magic links", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    signInWithOtp.mockReset();
  });

  it("signs in existing users without creating a new account", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    const { sendMagicLink } = await import("./supabase");

    await sendMagicLink("existing@example.com");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "existing@example.com",
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: false,
      },
    });
  });

  it("surfaces a rejected sign-in without retrying as a signup", async () => {
    const error = new Error("Signups not allowed for otp");
    signInWithOtp.mockResolvedValue({ error });
    const { sendMagicLink } = await import("./supabase");

    await expect(sendMagicLink("new@example.com")).rejects.toBe(error);
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });
});
