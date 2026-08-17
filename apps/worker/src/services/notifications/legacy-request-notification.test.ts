import { describe, expect, it } from "vitest";
import { renderNotification } from "./redaction.js";
import { buildLegacyApprovalNotification } from "./legacy-request-notification.js";

describe("legacy request notification bridge", () => {
  it("turns an unclassified legacy request into a confidential, open-only notification", () => {
    const previousWebUrl = process.env["WEB_URL"];
    process.env["WEB_URL"] = "https://inbox.example/";

    try {
      const notification = buildLegacyApprovalNotification(
        {
          id: "req_sensitive",
          title: "Export customer records",
          description: "Contains a bearer token and regulated account data.",
          priority: "critical",
          timeoutAt: null,
        },
        "ntf_sensitive",
      );
      const rendered = renderNotification("email", notification);

      expect(notification).toMatchObject({
        classification: "confidential",
        riskClass: "R3",
        urgency: "critical",
        deepLink: "https://inbox.example/inbox/req_sensitive",
      });
      expect(rendered.action).toBe("open_securely");
      expect(rendered.text).not.toContain("Export customer records");
      expect(rendered.text).not.toContain("regulated account data");
      expect(rendered.text).toContain(notification.deepLink);
    } finally {
      if (previousWebUrl === undefined) {
        delete process.env["WEB_URL"];
      } else {
        process.env["WEB_URL"] = previousWebUrl;
      }
    }
  });
});
