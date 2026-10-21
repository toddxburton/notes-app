import { describe, expect, it } from "vitest";
import { parseSignInLink } from "./supabase";

const projectUrl = "https://example.supabase.co";

describe("installed-app sign-in link", () => {
  it("extracts the token from a Supabase magic link", () => {
    expect(parseSignInLink("https://example.supabase.co/auth/v1/verify?token=abc123&type=magiclink&redirect_to=https%3A%2F%2Fnoted.example%2F", projectUrl))
      .toBe("abc123");
  });

  it("rejects links from another project", () => {
    expect(() => parseSignInLink("https://other.supabase.co/auth/v1/verify?token=abc123&type=magiclink", projectUrl))
      .toThrow("not a Noted sign-in link");
  });
});
