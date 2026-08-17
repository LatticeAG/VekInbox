import { describe, expect, it } from "vitest";
import { isAdminWorkspaceRole } from "../src/middleware/workspace-scope.ts";

describe("workspace administration roles", () => {
  it("limits notification-configuration authority to owners and admins", () => {
    expect(isAdminWorkspaceRole("owner")).toBe(true);
    expect(isAdminWorkspaceRole("admin")).toBe(true);
    expect(isAdminWorkspaceRole("reviewer")).toBe(false);
    expect(isAdminWorkspaceRole("viewer")).toBe(false);
    expect(isAdminWorkspaceRole("unknown")).toBe(false);
  });
});
