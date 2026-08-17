import { describe, expect, it } from "vitest";
import { createPolicySchema } from "./policy.js";

describe("createPolicySchema", () => {
  const basePolicy = {
    name: "Safe timeout policy",
    steps: [{ delay_ms: 60_000, notify: {} }],
  };

  it("defaults a timeout outcome to decline", () => {
    expect(createPolicySchema.parse(basePolicy).default_action_on_timeout).toBe(
      "decline",
    );
  });

  it("allows only safe legacy timeout outcomes", () => {
    expect(
      createPolicySchema.parse({
        ...basePolicy,
        default_action_on_timeout: "escalate",
      }).default_action_on_timeout,
    ).toBe("escalate");

    expect(() =>
      createPolicySchema.parse({
        ...basePolicy,
        default_action_on_timeout: "approve",
      }),
    ).toThrow();
  });
});
