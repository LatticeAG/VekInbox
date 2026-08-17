import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "reviewer",
  "viewer",
]);

export const notificationChannelTypeEnum = pgEnum("notification_channel_type", [
  "email",
  "slack",
  "web",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "declined",
  "timed_out",
  "escalated",
  "cancelled",
  "changes_requested",
]);

export const requestPriorityEnum = pgEnum("request_priority", [
  "low",
  "normal",
  "high",
  "critical",
]);

export const actorTypeEnum = pgEnum("actor_type", [
  "user",
  "agent",
  "system",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    settings: jsonb("settings").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("workspaces_org_slug_unique").on(
      table.organizationId,
      table.slug,
    ),
    // V3 uses organizations as the tenant boundary and workspaces as the
    // project boundary while the OSS compatibility model is still in place.
    // This constraint is the target for every V3 tenant/workspace FK.
    unique("workspaces_organization_id_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("workspaces_organization_id_idx").on(table.organizationId),
  ],
);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    index("memberships_workspace_id_idx").on(table.workspaceId),
    index("memberships_user_id_idx").on(table.userId),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    webhookSecret: text("webhook_secret").notNull(),
    permissions: jsonb("permissions").notNull().default({}),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("agents_workspace_id_id_unique").on(table.workspaceId, table.id),
    index("agents_workspace_id_idx").on(table.workspaceId),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    name: text("name").notNull(),
    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
      mode: "date",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("api_keys_agent_id_idx").on(table.agentId)],
);

export const escalationPolicies = pgTable(
  "escalation_policies",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    steps: jsonb("steps").notNull().default([]),
    defaultActionOnTimeout: text("default_action_on_timeout")
      .notNull()
      .default("decline"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("escalation_policies_workspace_id_idx").on(table.workspaceId),
  ],
);

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: notificationChannelTypeEnum("type").notNull(),
    config: jsonb("config").notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("notification_channels_workspace_id_idx").on(table.workspaceId),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: requestStatusEnum("status").notNull().default("pending"),
    priority: requestPriorityEnum("priority").notNull().default("normal"),
    actions: jsonb("actions").notNull().default([]),
    defaultAction: text("default_action"),
    timeoutAt: timestamp("timeout_at", { withTimezone: true, mode: "date" }),
    escalationPolicyId: text("escalation_policy_id").references(
      () => escalationPolicies.id,
      { onDelete: "set null" },
    ),
    resumeWebhookUrl: text("resume_webhook_url"),
    metadata: jsonb("metadata").notNull().default({}),
    labels: text("labels").array().notNull().default([]),
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    resolutionAction: text("resolution_action"),
    resolutionNote: text("resolution_note"),
    resolutionPayload: jsonb("resolution_payload"),
    idempotencyReusedCount: integer("idempotency_reused_count")
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("requests_workspace_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    index("requests_workspace_status_created_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
    index("requests_timeout_at_idx").on(table.timeoutAt),
    index("requests_organization_id_idx").on(table.organizationId),
    index("requests_agent_id_idx").on(table.agentId),
  ],
);

export const requestEvents = pgTable(
  "request_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("request_events_request_id_created_idx").on(
      table.requestId,
      table.createdAt,
    ),
  ],
);

export const requestAssignments = pgTable(
  "request_assignments",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("request_assignments_request_id_idx").on(table.requestId),
    index("request_assignments_user_id_idx").on(table.userId),
  ],
);

export const requestNotifications = pgTable(
  "request_notifications",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    channelId: text("channel_id").references(() => notificationChannels.id, {
      onDelete: "set null",
    }),
    channelType: text("channel_type").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("request_notifications_request_id_idx").on(table.requestId),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", {
      withTimezone: true,
      mode: "date",
    }),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "date",
    }),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("webhook_deliveries_request_id_idx").on(table.requestId),
    index("webhook_deliveries_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  workspaces: many(workspaces),
  requests: many(requests),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workspaces.organizationId],
    references: [organizations.id],
  }),
  memberships: many(memberships),
  agents: many(agents),
  escalationPolicies: many(escalationPolicies),
  notificationChannels: many(notificationChannels),
  requests: many(requests),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  resolvedRequests: many(requests),
  requestAssignments: many(requestAssignments),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [memberships.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [agents.workspaceId],
    references: [workspaces.id],
  }),
  apiKeys: many(apiKeys),
  requests: many(requests),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  agent: one(agents, {
    fields: [apiKeys.agentId],
    references: [agents.id],
  }),
}));

export const escalationPoliciesRelations = relations(
  escalationPolicies,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [escalationPolicies.workspaceId],
      references: [workspaces.id],
    }),
    requests: many(requests),
  }),
);

export const notificationChannelsRelations = relations(
  notificationChannels,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [notificationChannels.workspaceId],
      references: [workspaces.id],
    }),
    requestNotifications: many(requestNotifications),
  }),
);

export const requestsRelations = relations(requests, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [requests.organizationId],
    references: [organizations.id],
  }),
  workspace: one(workspaces, {
    fields: [requests.workspaceId],
    references: [workspaces.id],
  }),
  agent: one(agents, {
    fields: [requests.agentId],
    references: [agents.id],
  }),
  escalationPolicy: one(escalationPolicies, {
    fields: [requests.escalationPolicyId],
    references: [escalationPolicies.id],
  }),
  resolvedByUser: one(users, {
    fields: [requests.resolvedBy],
    references: [users.id],
  }),
  events: many(requestEvents),
  assignments: many(requestAssignments),
  notifications: many(requestNotifications),
  webhookDeliveries: many(webhookDeliveries),
}));

export const requestEventsRelations = relations(requestEvents, ({ one }) => ({
  request: one(requests, {
    fields: [requestEvents.requestId],
    references: [requests.id],
  }),
}));

export const requestAssignmentsRelations = relations(
  requestAssignments,
  ({ one }) => ({
    request: one(requests, {
      fields: [requestAssignments.requestId],
      references: [requests.id],
    }),
    user: one(users, {
      fields: [requestAssignments.userId],
      references: [users.id],
    }),
  }),
);

export const requestNotificationsRelations = relations(
  requestNotifications,
  ({ one }) => ({
    request: one(requests, {
      fields: [requestNotifications.requestId],
      references: [requests.id],
    }),
    channel: one(notificationChannels, {
      fields: [requestNotifications.channelId],
      references: [notificationChannels.id],
    }),
  }),
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    request: one(requests, {
      fields: [webhookDeliveries.requestId],
      references: [requests.id],
    }),
  }),
);

// V3 approval data plane ----------------------------------------------------
//
// The OSS `organizations` and `workspaces` tables are the transitional
// tenant/project aliases described in V3-SPEC.  Every V3 row carries both
// columns and uses a composite FK to prevent a workspace from being borrowed
// from another tenant.  New V3 code must scope queries by both values.

export const v3RiskClassEnum = pgEnum("v3_risk_class", [
  "R0",
  "R1",
  "R2",
  "R3",
  "R4",
]);

export const approvalTemplateLifecycleEnum = pgEnum(
  "approval_template_lifecycle",
  ["draft", "published", "retired"],
);

export const approvalPolicyLifecycleEnum = pgEnum(
  "approval_policy_lifecycle",
  ["draft", "published", "retired"],
);

export const approvalCaseLifecycleEnum = pgEnum("approval_case_lifecycle", [
  "draft",
  "scheduled",
  "open",
  "awaiting_effective_time",
  "resolved",
  "expired",
  "cancelled",
  "superseded",
]);

export const approvalCaseOutcomeEnum = pgEnum("approval_case_outcome", [
  "approved",
  "declined",
  "revision_requested",
  "expired",
  "cancelled",
]);

export const caseStageStateEnum = pgEnum("case_stage_state", [
  "pending",
  "open",
  "satisfied",
  "blocked",
  "skipped",
  "timed_out",
]);

export const stageParticipantStatusEnum = pgEnum("stage_participant_status", [
  "eligible",
  "ineligible",
  "removed",
  "satisfied",
]);

export const approvalDecisionResponseEnum = pgEnum(
  "approval_decision_response",
  ["approve", "decline", "request_changes", "acknowledge"],
);

export const contextItemTypeEnum = pgEnum("context_item_type", [
  "structured_fields",
  "diff",
  "log_bundle",
  "screenshot",
  "artifact",
  "external_link",
  "reviewer_instruction",
  "decision_evidence",
]);

export const contextClassificationEnum = pgEnum("context_classification", [
  "public",
  "internal",
  "confidential",
  "restricted",
]);

export const contextScanStateEnum = pgEnum("context_scan_state", [
  "pending",
  "ready",
  "rejected",
  "failed",
]);

export const contextRedactionStateEnum = pgEnum("context_redaction_state", [
  "unredacted",
  "redacted",
  "withheld",
]);

export const scheduledDecisionStatusEnum = pgEnum(
  "scheduled_decision_status",
  [
    "pending_confirmation",
    "confirmed_and_submitted",
    "cancelled",
    "expired",
    "stale",
    "ineligible",
    "assurance_failed",
  ],
);

export const scheduleWorkTypeEnum = pgEnum("schedule_work_type", [
  "case_open",
  "stage_deadline",
  "escalation",
  "scheduled_decision",
  "case_effective",
  "release_expiry",
  "notification_retry",
]);

export const scheduleWorkStatusEnum = pgEnum("schedule_work_status", [
  "pending",
  "leased",
  "completed",
  "cancelled",
  "dead_letter",
]);

export const escalationRunStatusEnum = pgEnum("escalation_run_status", [
  "scheduled",
  "running",
  "completed",
  "suppressed",
  "failed",
]);

export const notificationIntentStateEnum = pgEnum("notification_intent_state", [
  "planned",
  "dispatching",
  "completed",
  "cancelled",
]);

export const v3NotificationChannelEnum = pgEnum("v3_notification_channel", [
  "web",
  "email",
  "slack",
  "teams",
  "discord",
  "sms",
  "push",
]);

export const notificationDeliveryStateEnum = pgEnum(
  "notification_delivery_state",
  [
    "planned",
    "accepted",
    "delivered",
    "viewed",
    "acknowledged",
    "failed_retryable",
    "failed_terminal",
    "suppressed",
  ],
);

export const outboxStateEnum = pgEnum("outbox_state", [
  "pending",
  "leased",
  "published",
  "dead_letter",
]);

export const executionReleaseStateEnum = pgEnum("execution_release_state", [
  "released",
  "consumed",
  "executed",
  "failed_verified",
  "execution_unknown",
  "invalidated",
  "compensation_required",
  "expired",
]);

export const executionReceiptTierEnum = pgEnum("execution_receipt_tier", [
  "agent_asserted",
  "gateway_verified",
  "downstream_attested",
]);

export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    lifecycle: approvalPolicyLifecycleEnum("lifecycle")
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "approval_policies_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("cascade"),
    unique("approval_policies_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("approval_policies_scope_name_unique").on(
      table.tenantId,
      table.workspaceId,
      table.name,
    ),
    index("approval_policies_workspace_lifecycle_idx").on(
      table.workspaceId,
      table.lifecycle,
    ),
  ],
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    policyId: text("policy_id").notNull(),
    version: integer("version").notNull(),
    normalizedDsl: jsonb("normalized_dsl").notNull(),
    compilerVersion: text("compiler_version").notNull(),
    policyHash: text("policy_hash").notNull(),
    validationReport: jsonb("validation_report").notNull().default({}),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "policy_versions_scope_policy_fk",
      columns: [table.tenantId, table.workspaceId, table.policyId],
      foreignColumns: [
        approvalPolicies.tenantId,
        approvalPolicies.workspaceId,
        approvalPolicies.id,
      ],
    }).onDelete("restrict"),
    unique("policy_versions_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("policy_versions_policy_version_unique").on(
      table.policyId,
      table.version,
    ),
    index("policy_versions_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const approvalTemplates = pgTable(
  "approval_templates",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    lifecycle: approvalTemplateLifecycleEnum("lifecycle")
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "approval_templates_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("cascade"),
    unique("approval_templates_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("approval_templates_scope_name_unique").on(
      table.tenantId,
      table.workspaceId,
      table.name,
    ),
    index("approval_templates_workspace_lifecycle_idx").on(
      table.workspaceId,
      table.lifecycle,
    ),
  ],
);

export const templateVersions = pgTable(
  "template_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    templateId: text("template_id").notNull(),
    version: integer("version").notNull(),
    actionInputSchema: jsonb("action_input_schema").notNull(),
    contextRequirements: jsonb("context_requirements").notNull().default({}),
    decisionCatalog: jsonb("decision_catalog").notNull().default({}),
    policyVersionId: text("policy_version_id").notNull(),
    riskClass: v3RiskClassEnum("risk_class").notNull(),
    actionCatalogDigest: text("action_catalog_digest").notNull(),
    templateDocument: jsonb("template_document").notNull(),
    templateHash: text("template_hash").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "template_versions_scope_template_fk",
      columns: [table.tenantId, table.workspaceId, table.templateId],
      foreignColumns: [
        approvalTemplates.tenantId,
        approvalTemplates.workspaceId,
        approvalTemplates.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "template_versions_scope_policy_version_fk",
      columns: [table.tenantId, table.workspaceId, table.policyVersionId],
      foreignColumns: [
        policyVersions.tenantId,
        policyVersions.workspaceId,
        policyVersions.id,
      ],
    }).onDelete("restrict"),
    unique("template_versions_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("template_versions_template_version_unique").on(
      table.templateId,
      table.version,
    ),
    index("template_versions_workspace_risk_created_idx").on(
      table.workspaceId,
      table.riskClass,
      table.createdAt,
    ),
  ],
);

export const approvalThreads = pgTable(
  "approval_threads",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    agentPrincipalId: text("agent_principal_id").notNull(),
    externalKey: text("external_key").notNull(),
    activeCaseId: text("active_case_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "approval_threads_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "approval_threads_workspace_agent_fk",
      columns: [table.workspaceId, table.agentPrincipalId],
      foreignColumns: [agents.workspaceId, agents.id],
    }).onDelete("restrict"),
    unique("approval_threads_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("approval_threads_agent_external_key_unique").on(
      table.workspaceId,
      table.agentPrincipalId,
      table.externalKey,
    ),
    index("approval_threads_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const approvalCases = pgTable(
  "approval_cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    threadId: text("thread_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    supersedesCaseId: text("supersedes_case_id"),
    lifecycle: approvalCaseLifecycleEnum("lifecycle").notNull().default("draft"),
    outcome: approvalCaseOutcomeEnum("outcome"),
    riskClass: v3RiskClassEnum("risk_class").notNull(),
    // This version is owned by the database projection and is the only
    // version suitable for `UPDATE ... WHERE version = expected` CAS.
    version: integer("version").notNull().default(1),
    runtimeState: jsonb("runtime_state").notNull().default({}),
    canonicalAction: jsonb("canonical_action").notNull(),
    actionDigest: text("action_digest").notNull(),
    contextManifestDigest: text("context_manifest_digest").notNull(),
    templateVersionId: text("template_version_id").notNull(),
    policyVersionId: text("policy_version_id").notNull(),
    guardrailBaselineVersion: text("guardrail_baseline_version"),
    openAt: timestamp("open_at", { withTimezone: true, mode: "date" }),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "approval_cases_scope_thread_fk",
      columns: [table.tenantId, table.workspaceId, table.threadId],
      foreignColumns: [
        approvalThreads.tenantId,
        approvalThreads.workspaceId,
        approvalThreads.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "approval_cases_scope_template_version_fk",
      columns: [table.tenantId, table.workspaceId, table.templateVersionId],
      foreignColumns: [
        templateVersions.tenantId,
        templateVersions.workspaceId,
        templateVersions.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "approval_cases_scope_policy_version_fk",
      columns: [table.tenantId, table.workspaceId, table.policyVersionId],
      foreignColumns: [
        policyVersions.tenantId,
        policyVersions.workspaceId,
        policyVersions.id,
      ],
    }).onDelete("restrict"),
    unique("approval_cases_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("approval_cases_thread_revision_unique").on(
      table.threadId,
      table.revisionNumber,
    ),
    index("approval_cases_workspace_lifecycle_created_idx").on(
      table.workspaceId,
      table.lifecycle,
      table.createdAt,
    ),
    index("approval_cases_workspace_action_digest_idx").on(
      table.workspaceId,
      table.actionDigest,
    ),
  ],
);

export const caseStages = pgTable(
  "case_stages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    stageKey: text("stage_key").notNull(),
    stageIndex: integer("stage_index").notNull(),
    activationDependencies: jsonb("activation_dependencies").notNull().default([]),
    approvalRule: jsonb("approval_rule").notNull(),
    requiredCount: integer("required_count"),
    denominator: integer("denominator"),
    state: caseStageStateEnum("state").notNull().default("pending"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: "date" }),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "case_stages_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("cascade"),
    unique("case_stages_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    unique("case_stages_scope_case_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.caseId,
      table.id,
    ),
    uniqueIndex("case_stages_case_stage_key_unique").on(
      table.caseId,
      table.stageKey,
    ),
    uniqueIndex("case_stages_case_stage_index_unique").on(
      table.caseId,
      table.stageIndex,
    ),
    index("case_stages_open_deadline_idx").on(
      table.workspaceId,
      table.state,
      table.deadlineAt,
    ),
  ],
);

export const stageParticipants = pgTable(
  "stage_participants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    stageId: text("stage_id").notNull(),
    principalId: text("principal_id").notNull(),
    resolverType: text("resolver_type").notNull(),
    resolverSnapshot: jsonb("resolver_snapshot").notNull().default({}),
    eligibilitySnapshot: jsonb("eligibility_snapshot").notNull().default({}),
    status: stageParticipantStatusEnum("status").notNull().default("eligible"),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      name: "stage_participants_scope_case_stage_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId, table.stageId],
      foreignColumns: [
        caseStages.tenantId,
        caseStages.workspaceId,
        caseStages.caseId,
        caseStages.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("stage_participants_stage_principal_unique").on(
      table.stageId,
      table.principalId,
    ),
    index("stage_participants_principal_status_idx").on(
      table.workspaceId,
      table.principalId,
      table.status,
    ),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    stageId: text("stage_id").notNull(),
    sequence: integer("sequence").notNull(),
    actorPrincipalId: text("actor_principal_id").notNull(),
    response: approvalDecisionResponseEnum("response").notNull(),
    reason: text("reason"),
    structuredPayload: jsonb("structured_payload").notNull().default({}),
    assuranceFacts: jsonb("assurance_facts").notNull().default({}),
    actionDigest: text("action_digest").notNull(),
    contextManifestDigest: text("context_manifest_digest").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "decisions_scope_case_stage_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId, table.stageId],
      foreignColumns: [
        caseStages.tenantId,
        caseStages.workspaceId,
        caseStages.caseId,
        caseStages.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("decisions_case_sequence_unique").on(
      table.caseId,
      table.sequence,
    ),
    uniqueIndex("decisions_case_actor_idempotency_unique").on(
      table.caseId,
      table.actorPrincipalId,
      table.idempotencyKey,
    ),
    index("decisions_stage_accepted_idx").on(table.stageId, table.acceptedAt),
    index("decisions_workspace_actor_idx").on(
      table.workspaceId,
      table.actorPrincipalId,
    ),
  ],
);

export const contextItems = pgTable(
  "context_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    type: contextItemTypeEnum("type").notNull(),
    objectReference: text("object_reference"),
    externalUrl: text("external_url"),
    structuredValue: jsonb("structured_value"),
    submittedDigest: text("submitted_digest"),
    observedDigest: text("observed_digest"),
    scanState: contextScanStateEnum("scan_state").notNull().default("pending"),
    classification: contextClassificationEnum("classification")
      .notNull()
      .default("internal"),
    redactionState: contextRedactionStateEnum("redaction_state")
      .notNull()
      .default("withheld"),
    trustedVerdict: jsonb("trusted_verdict").notNull().default({}),
    provenance: jsonb("provenance").notNull().default({}),
    retentionPolicy: jsonb("retention_policy").notNull().default({}),
    readyAt: timestamp("ready_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "context_items_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("cascade"),
    unique("context_items_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    index("context_items_workspace_scan_state_idx").on(
      table.workspaceId,
      table.scanState,
      table.createdAt,
    ),
    index("context_items_workspace_digest_idx").on(
      table.workspaceId,
      table.observedDigest,
    ),
  ],
);

export const contextManifests = pgTable(
  "context_manifests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    canonicalItems: jsonb("canonical_items").notNull(),
    digest: text("digest").notNull(),
    classification: contextClassificationEnum("classification").notNull(),
    classificationSummary: jsonb("classification_summary").notNull().default({}),
    sealedAt: timestamp("sealed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "context_manifests_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("restrict"),
    unique("context_manifests_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("context_manifests_case_unique").on(table.caseId),
    uniqueIndex("context_manifests_case_digest_unique").on(
      table.caseId,
      table.digest,
    ),
    index("context_manifests_workspace_digest_idx").on(
      table.workspaceId,
      table.digest,
    ),
  ],
);

export const contextManifestItems = pgTable(
  "context_manifest_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    manifestId: text("manifest_id").notNull(),
    contextItemId: text("context_item_id").notNull(),
    position: integer("position").notNull(),
    itemDigest: text("item_digest").notNull(),
    classification: contextClassificationEnum("classification").notNull(),
    redactionState: contextRedactionStateEnum("redaction_state").notNull(),
    provenanceSnapshot: jsonb("provenance_snapshot").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "context_manifest_items_scope_manifest_fk",
      columns: [table.tenantId, table.workspaceId, table.manifestId],
      foreignColumns: [
        contextManifests.tenantId,
        contextManifests.workspaceId,
        contextManifests.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "context_manifest_items_scope_item_fk",
      columns: [table.tenantId, table.workspaceId, table.contextItemId],
      foreignColumns: [
        contextItems.tenantId,
        contextItems.workspaceId,
        contextItems.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("context_manifest_items_manifest_position_unique").on(
      table.manifestId,
      table.position,
    ),
    uniqueIndex("context_manifest_items_manifest_item_unique").on(
      table.manifestId,
      table.contextItemId,
    ),
  ],
);

export const scheduledDecisions = pgTable(
  "scheduled_decisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    stageId: text("stage_id").notNull(),
    requestingPrincipalId: text("requesting_principal_id").notNull(),
    response: approvalDecisionResponseEnum("response").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    actionDigest: text("action_digest").notNull(),
    contextManifestDigest: text("context_manifest_digest").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" })
      .notNull(),
    timezone: text("timezone").notNull(),
    localTimeExpression: text("local_time_expression"),
    dstDisambiguation: text("dst_disambiguation"),
    maxLeadSeconds: integer("max_lead_seconds").notNull(),
    requiresFreshConfirmation: boolean("requires_fresh_confirmation")
      .notNull()
      .default(true),
    minimumAssurance: text("minimum_assurance")
      .notNull()
      .$type<"none" | "verified_session" | "step_up">(),
    status: scheduledDecisionStatusEnum("status")
      .notNull()
      .default("pending_confirmation"),
    cancellationReason: text("cancellation_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
    submittedDecisionId: text("submitted_decision_id").references(
      () => decisions.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "scheduled_decisions_scope_case_stage_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId, table.stageId],
      foreignColumns: [
        caseStages.tenantId,
        caseStages.workspaceId,
        caseStages.caseId,
        caseStages.id,
      ],
    }).onDelete("restrict"),
    index("scheduled_decisions_due_status_idx").on(
      table.workspaceId,
      table.status,
      table.effectiveAt,
    ),
    index("scheduled_decisions_case_principal_idx").on(
      table.caseId,
      table.requestingPrincipalId,
    ),
  ],
);

export const scheduleWork = pgTable(
  "schedule_work",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    stageId: text("stage_id"),
    workType: scheduleWorkTypeEnum("work_type").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(),
    conditionHash: text("condition_hash").notNull(),
    caseVersion: integer("case_version").notNull(),
    workKey: text("work_key").notNull(),
    status: scheduleWorkStatusEnum("status").notNull().default("pending"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(10),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "schedule_work_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "schedule_work_scope_case_stage_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId, table.stageId],
      foreignColumns: [
        caseStages.tenantId,
        caseStages.workspaceId,
        caseStages.caseId,
        caseStages.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("schedule_work_scope_work_key_unique").on(
      table.tenantId,
      table.workspaceId,
      table.workKey,
    ),
    index("schedule_work_claim_idx").on(
      table.status,
      table.dueAt,
      table.leaseExpiresAt,
    ),
    index("schedule_work_case_status_idx").on(table.caseId, table.status),
  ],
);

export const escalationRuns = pgTable(
  "escalation_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    stageId: text("stage_id"),
    // Case-scoped ladders use the stable `case` scope key; stage-scoped
    // ladders use the stage ID. This avoids PostgreSQL NULL-unique loopholes.
    scopeKey: text("scope_key").notNull(),
    ladderVersion: text("ladder_version").notNull(),
    stepIndex: integer("step_index").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(),
    targetResolution: jsonb("target_resolution").notNull().default({}),
    status: escalationRunStatusEnum("status").notNull().default("scheduled"),
    outcome: jsonb("outcome").notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "escalation_runs_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "escalation_runs_scope_case_stage_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId, table.stageId],
      foreignColumns: [
        caseStages.tenantId,
        caseStages.workspaceId,
        caseStages.caseId,
        caseStages.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("escalation_runs_case_ladder_scope_step_unique").on(
      table.caseId,
      table.ladderVersion,
      table.scopeKey,
      table.stepIndex,
    ),
    index("escalation_runs_due_status_idx").on(
      table.workspaceId,
      table.status,
      table.dueAt,
    ),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id"),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    payloadHash: text("payload_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    state: outboxStateEnum("state").notNull().default("pending"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "outbox_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "outbox_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("outbox_scope_idempotency_unique").on(
      table.tenantId,
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("outbox_claim_idx").on(
      table.state,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    index("outbox_aggregate_idx").on(table.aggregateType, table.aggregateId),
  ],
);

export const commandIdempotency = pgTable(
  "command_idempotency",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    method: text("method").notNull(),
    canonicalRoute: text("canonical_route").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    canonicalRequestHash: text("canonical_request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "command_idempotency_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("cascade"),
    uniqueIndex("command_idempotency_principal_route_key_unique").on(
      table.tenantId,
      table.workspaceId,
      table.principalId,
      table.method,
      table.canonicalRoute,
      table.idempotencyKey,
    ),
    index("command_idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const notificationIntents = pgTable(
  "notification_intents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    stageId: text("stage_id"),
    policyStepKey: text("policy_step_key"),
    recipientPrincipalId: text("recipient_principal_id").notNull(),
    disclosureClassification: contextClassificationEnum(
      "disclosure_classification",
    ).notNull(),
    renderedSummaryVersion: text("rendered_summary_version").notNull(),
    renderedPayloadHash: text("rendered_payload_hash").notNull(),
    allowedContextFields: jsonb("allowed_context_fields").notNull().default([]),
    channelCandidates: jsonb("channel_candidates").notNull().default([]),
    endpointSnapshot: jsonb("endpoint_snapshot").notNull().default({}),
    urgency: text("urgency").notNull().default("normal"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    dedupeKey: text("dedupe_key").notNull(),
    state: notificationIntentStateEnum("state").notNull().default("planned"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "notification_intents_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "notification_intents_scope_case_stage_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId, table.stageId],
      foreignColumns: [
        caseStages.tenantId,
        caseStages.workspaceId,
        caseStages.caseId,
        caseStages.id,
      ],
    }).onDelete("cascade"),
    unique("notification_intents_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("notification_intents_scope_dedupe_unique").on(
      table.tenantId,
      table.workspaceId,
      table.dedupeKey,
    ),
    index("notification_intents_dispatch_idx").on(
      table.workspaceId,
      table.state,
      table.createdAt,
    ),
    index("notification_intents_case_recipient_idx").on(
      table.caseId,
      table.recipientPrincipalId,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    intentId: text("intent_id").notNull(),
    provider: text("provider").notNull(),
    channel: v3NotificationChannelEnum("channel").notNull(),
    endpointSnapshot: jsonb("endpoint_snapshot").notNull(),
    attempt: integer("attempt").notNull(),
    providerRequestId: text("provider_request_id"),
    state: notificationDeliveryStateEnum("state").notNull().default("planned"),
    errorClass: text("error_class"),
    errorDetail: text("error_detail"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "date" }),
    acknowledgedAt: timestamp("acknowledged_at", {
      withTimezone: true,
      mode: "date",
    }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: "date" }),
    correlationId: text("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "notification_deliveries_scope_intent_fk",
      columns: [table.tenantId, table.workspaceId, table.intentId],
      foreignColumns: [
        notificationIntents.tenantId,
        notificationIntents.workspaceId,
        notificationIntents.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("notification_deliveries_intent_attempt_unique").on(
      table.intentId,
      table.attempt,
    ),
    uniqueIndex("notification_deliveries_provider_request_unique").on(
      table.provider,
      table.providerRequestId,
    ),
    index("notification_deliveries_active_retry_idx").on(
      table.state,
      table.nextRetryAt,
    ),
  ],
);

export const executionReleases = pgTable(
  "execution_releases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    nonce: text("nonce").notNull(),
    actionDigest: text("action_digest").notNull(),
    audience: text("audience").notNull(),
    permittedOperation: text("permitted_operation").notNull(),
    resourceScope: jsonb("resource_scope").notNull(),
    templateVersionId: text("template_version_id").notNull(),
    policyVersionId: text("policy_version_id").notNull(),
    assuranceLevel: text("assurance_level").notNull(),
    state: executionReleaseStateEnum("state").notNull().default("released"),
    version: integer("version").notNull().default(1),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    invalidatedAt: timestamp("invalidated_at", {
      withTimezone: true,
      mode: "date",
    }),
    invalidationReason: text("invalidation_reason"),
    receiptRequired: boolean("receipt_required").notNull().default(false),
    minimumReceiptTier: executionReceiptTierEnum("minimum_receipt_tier"),
    receiptDueAt: timestamp("receipt_due_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "execution_releases_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "execution_releases_scope_template_version_fk",
      columns: [table.tenantId, table.workspaceId, table.templateVersionId],
      foreignColumns: [
        templateVersions.tenantId,
        templateVersions.workspaceId,
        templateVersions.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "execution_releases_scope_policy_version_fk",
      columns: [table.tenantId, table.workspaceId, table.policyVersionId],
      foreignColumns: [
        policyVersions.tenantId,
        policyVersions.workspaceId,
        policyVersions.id,
      ],
    }).onDelete("restrict"),
    unique("execution_releases_scope_id_unique").on(
      table.tenantId,
      table.workspaceId,
      table.id,
    ),
    uniqueIndex("execution_releases_nonce_unique").on(table.nonce),
    index("execution_releases_case_state_idx").on(table.caseId, table.state),
    index("execution_releases_expiry_idx").on(table.state, table.expiresAt),
  ],
);

export const executionReceipts = pgTable(
  "execution_receipts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    releaseId: text("release_id").notNull(),
    tier: executionReceiptTierEnum("tier").notNull(),
    downstreamOperationId: text("downstream_operation_id"),
    observedActionDigest: text("observed_action_digest").notNull(),
    outcome: text("outcome").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    verifierPrincipalId: text("verifier_principal_id"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "execution_receipts_scope_release_fk",
      columns: [table.tenantId, table.workspaceId, table.releaseId],
      foreignColumns: [
        executionReleases.tenantId,
        executionReleases.workspaceId,
        executionReleases.id,
      ],
    }).onDelete("restrict"),
    index("execution_receipts_release_received_idx").on(
      table.releaseId,
      table.receivedAt,
    ),
  ],
);

export const auditLedgerHeads = pgTable(
  "audit_ledger_heads",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    partitionKey: text("partition_key").notNull(),
    lastSequence: bigint("last_sequence", { mode: "number" })
      .notNull()
      .default(0),
    lastHash: text("last_hash").notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    foreignKey({
      name: "audit_ledger_heads_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("cascade"),
    uniqueIndex("audit_ledger_heads_partition_unique").on(
      table.tenantId,
      table.workspaceId,
      table.partitionKey,
    ),
  ],
);

export const auditLedgerEntries = pgTable(
  "audit_ledger_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    partitionKey: text("partition_key").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorPrincipalId: text("actor_principal_id"),
    caseId: text("case_id"),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    canonicalPayloadHash: text("canonical_payload_hash").notNull(),
    previousHash: text("previous_hash"),
    entryHash: text("entry_hash").notNull(),
    keyId: text("key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "audit_ledger_entries_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "audit_ledger_entries_scope_case_fk",
      columns: [table.tenantId, table.workspaceId, table.caseId],
      foreignColumns: [
        approvalCases.tenantId,
        approvalCases.workspaceId,
        approvalCases.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("audit_ledger_entries_partition_sequence_unique").on(
      table.tenantId,
      table.workspaceId,
      table.partitionKey,
      table.sequence,
    ),
    uniqueIndex("audit_ledger_entries_partition_hash_unique").on(
      table.tenantId,
      table.workspaceId,
      table.partitionKey,
      table.entryHash,
    ),
    index("audit_ledger_entries_export_range_idx").on(
      table.tenantId,
      table.workspaceId,
      table.partitionKey,
      table.sequence,
    ),
    index("audit_ledger_entries_case_created_idx").on(
      table.caseId,
      table.createdAt,
    ),
  ],
);

export const auditCheckpoints = pgTable(
  "audit_checkpoints",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    partitionKey: text("partition_key").notNull(),
    fromSequence: bigint("from_sequence", { mode: "number" }).notNull(),
    toSequence: bigint("to_sequence", { mode: "number" }).notNull(),
    rootHash: text("root_hash").notNull(),
    signerKeyId: text("signer_key_id").notNull(),
    externalAnchorReference: text("external_anchor_reference"),
    checkpointedAt: timestamp("checkpointed_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "audit_checkpoints_tenant_workspace_fk",
      columns: [table.tenantId, table.workspaceId],
      foreignColumns: [workspaces.organizationId, workspaces.id],
    }).onDelete("restrict"),
    uniqueIndex("audit_checkpoints_partition_to_sequence_unique").on(
      table.tenantId,
      table.workspaceId,
      table.partitionKey,
      table.toSequence,
    ),
    index("audit_checkpoints_export_range_idx").on(
      table.tenantId,
      table.workspaceId,
      table.partitionKey,
      table.fromSequence,
    ),
  ],
);
