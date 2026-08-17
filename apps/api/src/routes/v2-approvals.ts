import { Hono } from "hono";
import { listBuiltinApprovalTemplates } from "@latticeag/vekinbox-core";
import { notFound, validationError } from "@latticeag/vekinbox-shared";
import { requireApiKey } from "../middleware/auth.js";
import { requireReviewerOrApiKey } from "../middleware/dual-auth.js";
import { requireSession } from "../middleware/session.js";
import {
  assertReviewerMembership,
  assertWorkspaceMembership,
} from "../middleware/workspace-scope.js";
import {
  parseCaseVersion,
  requireV3IdempotencyKey,
  v3CreateApprovalCaseSchema,
  v3DecisionSchema,
  v3ScheduledDecisionSchema,
} from "../lib/v3-approval-contract.js";
import {
  createV3ApprovalCase,
  createV3ScheduledDecision,
  getV3ApprovalCase,
  getV3CaseScope,
  listV3Timeline,
  submitV3Decision,
} from "../services/v3-approval.service.js";

function parseBody<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : "Invalid V3 approval request");
  }
}

function mutationHeaders(c: { req: { header(name: string): string | undefined } }) {
  try {
    return {
      idempotencyKey: requireV3IdempotencyKey(c.req.header("Idempotency-Key")),
      expectedVersion: parseCaseVersion(c.req.header("If-Match")),
    };
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : "Invalid mutation headers");
  }
}

function createHeaders(c: { req: { header(name: string): string | undefined } }) {
  try {
    return requireV3IdempotencyKey(c.req.header("Idempotency-Key"));
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : "Invalid Idempotency-Key");
  }
}

/**
 * V3 case endpoints are deliberately separate from the v1 compatibility
 * request queue. A project path is validated against the authenticated agent,
 * and human decisions obtain identity only from a session.
 */
export const v2ApprovalRoutes = new Hono();

v2ApprovalRoutes.get("/templates", async (c) => {
  return c.json({
    data: listBuiltinApprovalTemplates().map((template) => ({
      id: template.id,
      version: template.version,
      name: template.name,
      description: template.description,
      risk_class: template.risk_class,
      action_requirements: template.action_requirements,
      context_requirements: template.context_requirements,
      policy_hash: template.policy.policy_hash,
      template_hash: template.template_hash,
    })),
  });
});

v2ApprovalRoutes.post("/projects/:projectId/approval-cases", requireApiKey(), async (c) => {
  const body = parseBody(v3CreateApprovalCaseSchema.parse, await c.req.json());
  const result = await createV3ApprovalCase(
    c.get("apiKeyAuth"),
    c.req.param("projectId")!,
    body,
    createHeaders(c),
  );
  return c.json(result.body, result.status);
});

v2ApprovalRoutes.get("/approval-cases/:caseId", requireReviewerOrApiKey, async (c) => {
  const caseId = c.req.param("caseId")!;
  const scope = await getV3CaseScope(caseId);
  const session = c.get("sessionAuth");
  if (session) {
    await assertWorkspaceMembership(session.userId, scope.workspaceId);
    return c.json(await getV3ApprovalCase(scope, caseId));
  }
  const auth = c.get("apiKeyAuth");
  if (auth.workspaceId !== scope.workspaceId) throw notFound("Approval case", caseId);
  return c.json(await getV3ApprovalCase(scope, caseId, auth.agentId));
});

v2ApprovalRoutes.get("/approval-cases/:caseId/timeline", requireReviewerOrApiKey, async (c) => {
  const caseId = c.req.param("caseId")!;
  const scope = await getV3CaseScope(caseId);
  const session = c.get("sessionAuth");
  if (session) {
    await assertWorkspaceMembership(session.userId, scope.workspaceId);
  } else {
    const auth = c.get("apiKeyAuth");
    if (auth.workspaceId !== scope.workspaceId) throw notFound("Approval case", caseId);
    // Verify that an agent cannot inspect another agent's case merely by
    // guessing its opaque ID.
    await getV3ApprovalCase(scope, caseId, auth.agentId);
  }
  return c.json(await listV3Timeline(scope, caseId));
});

v2ApprovalRoutes.post("/approval-cases/:caseId/decisions", requireSession(), async (c) => {
  const caseId = c.req.param("caseId")!;
  const session = c.get("sessionAuth");
  const scope = await getV3CaseScope(caseId);
  await assertReviewerMembership(session.userId, scope.workspaceId);
  const result = await submitV3Decision({
    caseId,
    scope,
    actorId: session.userId,
    ...mutationHeaders(c),
    input: parseBody(v3DecisionSchema.parse, await c.req.json()),
  });
  return c.json(result);
});

v2ApprovalRoutes.post(
  "/approval-cases/:caseId/scheduled-decisions",
  requireSession(),
  async (c) => {
    const caseId = c.req.param("caseId")!;
    const session = c.get("sessionAuth");
    const scope = await getV3CaseScope(caseId);
    await assertReviewerMembership(session.userId, scope.workspaceId);
    const result = await createV3ScheduledDecision({
      caseId,
      scope,
      actorId: session.userId,
      ...mutationHeaders(c),
      input: parseBody(v3ScheduledDecisionSchema.parse, await c.req.json()),
    });
    return c.json(result.body, result.status);
  },
);
