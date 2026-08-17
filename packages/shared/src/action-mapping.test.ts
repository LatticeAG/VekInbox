import { describe, expect, it } from "vitest";
import { actionToStatus } from "@latticeag/vekinbox-shared";

describe("legacy action outcome mapping", () => {
  it("maps only explicit standard decisions", () => {
    expect(actionToStatus("approve")).toBe("approved");
    expect(actionToStatus("decline")).toBe("declined");
    expect(actionToStatus("request_changes")).toBe("changes_requested");
  });

  it("does not treat an unmapped custom action as approval", () => {
    expect(actionToStatus("run_production_operation")).toBeNull();
  });
});
