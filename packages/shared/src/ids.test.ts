import { describe, expect, it } from "vitest";
import { generateId, isPrefixedId, parseIdPrefix } from "./ids.js";

describe("v3 friendly identifiers", () => {
  it("generates and recognizes V3 approval-plane IDs", () => {
    const id = generateId("case");
    expect(isPrefixedId(id, "case")).toBe(true);
    expect(parseIdPrefix(id)).toBe("case");
    expect(generateId("thread")).toMatch(/^thread_[A-Za-z0-9]{21}$/);
    expect(generateId("dec")).toMatch(/^dec_[A-Za-z0-9]{21}$/);
  });
});
