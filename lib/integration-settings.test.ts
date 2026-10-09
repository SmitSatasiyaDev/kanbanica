import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ env: {} }));

import { resolvePasswordSignup } from "@/lib/integration-settings";

describe("resolvePasswordSignup", () => {
  it("uses the .env flag until an admin has set the switch", () => {
    expect(resolvePasswordSignup(null, true)).toBe(true);
    expect(resolvePasswordSignup(undefined, false)).toBe(false);
  });

  it("lets the admin switch override .env in both directions", () => {
    expect(resolvePasswordSignup(true, false)).toBe(true);
    expect(resolvePasswordSignup(false, true)).toBe(false);
  });
});
