import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
  (table) => [index("agents_workspace_id_idx").on(table.workspaceId)],
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
