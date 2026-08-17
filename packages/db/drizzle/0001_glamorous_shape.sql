CREATE TYPE "public"."approval_case_lifecycle" AS ENUM('draft', 'scheduled', 'open', 'awaiting_effective_time', 'resolved', 'expired', 'cancelled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."approval_case_outcome" AS ENUM('approved', 'declined', 'revision_requested', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_decision_response" AS ENUM('approve', 'decline', 'request_changes', 'acknowledge');--> statement-breakpoint
CREATE TYPE "public"."approval_policy_lifecycle" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."approval_template_lifecycle" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."case_stage_state" AS ENUM('pending', 'open', 'satisfied', 'blocked', 'skipped', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."context_classification" AS ENUM('public', 'internal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."context_item_type" AS ENUM('structured_fields', 'diff', 'log_bundle', 'screenshot', 'artifact', 'external_link', 'reviewer_instruction', 'decision_evidence');--> statement-breakpoint
CREATE TYPE "public"."context_redaction_state" AS ENUM('unredacted', 'redacted', 'withheld');--> statement-breakpoint
CREATE TYPE "public"."context_scan_state" AS ENUM('pending', 'ready', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."escalation_run_status" AS ENUM('scheduled', 'running', 'completed', 'suppressed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."execution_receipt_tier" AS ENUM('agent_asserted', 'gateway_verified', 'downstream_attested');--> statement-breakpoint
CREATE TYPE "public"."execution_release_state" AS ENUM('released', 'consumed', 'executed', 'failed_verified', 'execution_unknown', 'invalidated', 'compensation_required', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_state" AS ENUM('planned', 'accepted', 'delivered', 'viewed', 'acknowledged', 'failed_retryable', 'failed_terminal', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."notification_intent_state" AS ENUM('planned', 'dispatching', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."outbox_state" AS ENUM('pending', 'leased', 'published', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."schedule_work_status" AS ENUM('pending', 'leased', 'completed', 'cancelled', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."schedule_work_type" AS ENUM('case_open', 'stage_deadline', 'escalation', 'scheduled_decision', 'case_effective', 'release_expiry', 'notification_retry');--> statement-breakpoint
CREATE TYPE "public"."scheduled_decision_status" AS ENUM('pending_confirmation', 'confirmed_and_submitted', 'cancelled', 'expired', 'stale', 'ineligible', 'assurance_failed');--> statement-breakpoint
CREATE TYPE "public"."stage_participant_status" AS ENUM('eligible', 'ineligible', 'removed', 'satisfied');--> statement-breakpoint
CREATE TYPE "public"."v3_notification_channel" AS ENUM('web', 'email', 'slack', 'teams', 'discord', 'sms', 'push');--> statement-breakpoint
CREATE TYPE "public"."v3_risk_class" AS ENUM('R0', 'R1', 'R2', 'R3', 'R4');--> statement-breakpoint
CREATE TABLE "approval_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"supersedes_case_id" text,
	"lifecycle" "approval_case_lifecycle" DEFAULT 'draft' NOT NULL,
	"outcome" "approval_case_outcome",
	"risk_class" "v3_risk_class" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"runtime_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"canonical_action" jsonb NOT NULL,
	"action_digest" text NOT NULL,
	"context_manifest_digest" text NOT NULL,
	"template_version_id" text NOT NULL,
	"policy_version_id" text NOT NULL,
	"guardrail_baseline_version" text,
	"open_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_cases_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"lifecycle" "approval_policy_lifecycle" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policies_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"lifecycle" "approval_template_lifecycle" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_templates_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_principal_id" text NOT NULL,
	"external_key" text NOT NULL,
	"active_case_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_threads_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"partition_key" text NOT NULL,
	"from_sequence" bigint NOT NULL,
	"to_sequence" bigint NOT NULL,
	"root_hash" text NOT NULL,
	"signer_key_id" text NOT NULL,
	"external_anchor_reference" text,
	"checkpointed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"partition_key" text NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_principal_id" text,
	"case_id" text,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"canonical_payload_hash" text NOT NULL,
	"previous_hash" text,
	"entry_hash" text NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_ledger_heads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"partition_key" text NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"last_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"stage_key" text NOT NULL,
	"stage_index" integer NOT NULL,
	"activation_dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_rule" jsonb NOT NULL,
	"required_count" integer,
	"denominator" integer,
	"state" "case_stage_state" DEFAULT 'pending' NOT NULL,
	"opened_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_stages_scope_id_unique" UNIQUE("tenant_id","workspace_id","id"),
	CONSTRAINT "case_stages_scope_case_id_unique" UNIQUE("tenant_id","workspace_id","case_id","id")
);
--> statement-breakpoint
CREATE TABLE "command_idempotency" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"method" text NOT NULL,
	"canonical_route" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"canonical_request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "context_item_type" NOT NULL,
	"object_reference" text,
	"external_url" text,
	"structured_value" jsonb,
	"submitted_digest" text,
	"observed_digest" text,
	"scan_state" "context_scan_state" DEFAULT 'pending' NOT NULL,
	"classification" "context_classification" DEFAULT 'internal' NOT NULL,
	"redaction_state" "context_redaction_state" DEFAULT 'withheld' NOT NULL,
	"trusted_verdict" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_items_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "context_manifest_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"manifest_id" text NOT NULL,
	"context_item_id" text NOT NULL,
	"position" integer NOT NULL,
	"item_digest" text NOT NULL,
	"classification" "context_classification" NOT NULL,
	"redaction_state" "context_redaction_state" NOT NULL,
	"provenance_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"canonical_items" jsonb NOT NULL,
	"digest" text NOT NULL,
	"classification" "context_classification" NOT NULL,
	"classification_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_manifests_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"actor_principal_id" text NOT NULL,
	"response" "approval_decision_response" NOT NULL,
	"reason" text,
	"structured_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assurance_facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_digest" text NOT NULL,
	"context_manifest_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"stage_id" text,
	"scope_key" text NOT NULL,
	"ladder_version" text NOT NULL,
	"step_index" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"target_resolution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "escalation_run_status" DEFAULT 'scheduled' NOT NULL,
	"outcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"release_id" text NOT NULL,
	"tier" "execution_receipt_tier" NOT NULL,
	"downstream_operation_id" text,
	"observed_action_digest" text NOT NULL,
	"outcome" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verifier_principal_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"nonce" text NOT NULL,
	"action_digest" text NOT NULL,
	"audience" text NOT NULL,
	"permitted_operation" text NOT NULL,
	"resource_scope" jsonb NOT NULL,
	"template_version_id" text NOT NULL,
	"policy_version_id" text NOT NULL,
	"assurance_level" text NOT NULL,
	"state" "execution_release_state" DEFAULT 'released' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"receipt_required" boolean DEFAULT false NOT NULL,
	"minimum_receipt_tier" "execution_receipt_tier",
	"receipt_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_releases_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"provider" text NOT NULL,
	"channel" "v3_notification_channel" NOT NULL,
	"endpoint_snapshot" jsonb NOT NULL,
	"attempt" integer NOT NULL,
	"provider_request_id" text,
	"state" "notification_delivery_state" DEFAULT 'planned' NOT NULL,
	"error_class" text,
	"error_detail" text,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"stage_id" text,
	"policy_step_key" text,
	"recipient_principal_id" text NOT NULL,
	"disclosure_classification" "context_classification" NOT NULL,
	"rendered_summary_version" text NOT NULL,
	"rendered_payload_hash" text NOT NULL,
	"allowed_context_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"endpoint_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"expires_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"state" "notification_intent_state" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_intents_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "outbox_state" DEFAULT 'pending' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"version" integer NOT NULL,
	"normalized_dsl" jsonb NOT NULL,
	"compiler_version" text NOT NULL,
	"policy_hash" text NOT NULL,
	"validation_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "schedule_work" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"stage_id" text,
	"work_type" "schedule_work_type" NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"condition_hash" text NOT NULL,
	"case_version" integer NOT NULL,
	"work_key" text NOT NULL,
	"status" "schedule_work_status" DEFAULT 'pending' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"requesting_principal_id" text NOT NULL,
	"response" "approval_decision_response" NOT NULL,
	"payload_digest" text NOT NULL,
	"action_digest" text NOT NULL,
	"context_manifest_digest" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"local_time_expression" text,
	"dst_disambiguation" text,
	"max_lead_seconds" integer NOT NULL,
	"requires_fresh_confirmation" boolean DEFAULT true NOT NULL,
	"minimum_assurance" text NOT NULL,
	"status" "scheduled_decision_status" DEFAULT 'pending_confirmation' NOT NULL,
	"cancellation_reason" text,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"submitted_decision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"case_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"resolver_type" text NOT NULL,
	"resolver_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"eligibility_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "stage_participant_status" DEFAULT 'eligible' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"action_input_schema" jsonb NOT NULL,
	"context_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision_catalog" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_version_id" text NOT NULL,
	"risk_class" "v3_risk_class" NOT NULL,
	"action_catalog_digest" text NOT NULL,
	"template_document" jsonb NOT NULL,
	"template_hash" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_versions_scope_id_unique" UNIQUE("tenant_id","workspace_id","id")
);
--> statement-breakpoint
-- These parent keys must exist before composite tenant/workspace FKs below.
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_id_unique" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_scope_thread_fk" FOREIGN KEY ("tenant_id","workspace_id","thread_id") REFERENCES "public"."approval_threads"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_scope_template_version_fk" FOREIGN KEY ("tenant_id","workspace_id","template_version_id") REFERENCES "public"."template_versions"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_cases" ADD CONSTRAINT "approval_cases_scope_policy_version_fk" FOREIGN KEY ("tenant_id","workspace_id","policy_version_id") REFERENCES "public"."policy_versions"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_templates" ADD CONSTRAINT "approval_templates_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_templates" ADD CONSTRAINT "approval_templates_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_threads" ADD CONSTRAINT "approval_threads_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_threads" ADD CONSTRAINT "approval_threads_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_threads" ADD CONSTRAINT "approval_threads_workspace_agent_fk" FOREIGN KEY ("workspace_id","agent_principal_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_checkpoints" ADD CONSTRAINT "audit_checkpoints_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_ledger_entries" ADD CONSTRAINT "audit_ledger_entries_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_ledger_entries" ADD CONSTRAINT "audit_ledger_entries_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_ledger_heads" ADD CONSTRAINT "audit_ledger_heads_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_ledger_heads" ADD CONSTRAINT "audit_ledger_heads_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_stages" ADD CONSTRAINT "case_stages_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_idempotency" ADD CONSTRAINT "command_idempotency_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_idempotency" ADD CONSTRAINT "command_idempotency_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_items" ADD CONSTRAINT "context_items_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_items" ADD CONSTRAINT "context_items_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_manifest_items" ADD CONSTRAINT "context_manifest_items_scope_manifest_fk" FOREIGN KEY ("tenant_id","workspace_id","manifest_id") REFERENCES "public"."context_manifests"("tenant_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_manifest_items" ADD CONSTRAINT "context_manifest_items_scope_item_fk" FOREIGN KEY ("tenant_id","workspace_id","context_item_id") REFERENCES "public"."context_items"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_manifests" ADD CONSTRAINT "context_manifests_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_scope_case_stage_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id","stage_id") REFERENCES "public"."case_stages"("tenant_id","workspace_id","case_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_runs" ADD CONSTRAINT "escalation_runs_scope_case_stage_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id","stage_id") REFERENCES "public"."case_stages"("tenant_id","workspace_id","case_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_receipts" ADD CONSTRAINT "execution_receipts_scope_release_fk" FOREIGN KEY ("tenant_id","workspace_id","release_id") REFERENCES "public"."execution_releases"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_releases" ADD CONSTRAINT "execution_releases_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_releases" ADD CONSTRAINT "execution_releases_scope_template_version_fk" FOREIGN KEY ("tenant_id","workspace_id","template_version_id") REFERENCES "public"."template_versions"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_releases" ADD CONSTRAINT "execution_releases_scope_policy_version_fk" FOREIGN KEY ("tenant_id","workspace_id","policy_version_id") REFERENCES "public"."policy_versions"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_scope_intent_fk" FOREIGN KEY ("tenant_id","workspace_id","intent_id") REFERENCES "public"."notification_intents"("tenant_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_scope_case_stage_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id","stage_id") REFERENCES "public"."case_stages"("tenant_id","workspace_id","case_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_workspace_fk" FOREIGN KEY ("tenant_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_scope_policy_fk" FOREIGN KEY ("tenant_id","workspace_id","policy_id") REFERENCES "public"."approval_policies"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_work" ADD CONSTRAINT "schedule_work_scope_case_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id") REFERENCES "public"."approval_cases"("tenant_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_work" ADD CONSTRAINT "schedule_work_scope_case_stage_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id","stage_id") REFERENCES "public"."case_stages"("tenant_id","workspace_id","case_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_decisions" ADD CONSTRAINT "scheduled_decisions_submitted_decision_id_decisions_id_fk" FOREIGN KEY ("submitted_decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_decisions" ADD CONSTRAINT "scheduled_decisions_scope_case_stage_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id","stage_id") REFERENCES "public"."case_stages"("tenant_id","workspace_id","case_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_participants" ADD CONSTRAINT "stage_participants_scope_case_stage_fk" FOREIGN KEY ("tenant_id","workspace_id","case_id","stage_id") REFERENCES "public"."case_stages"("tenant_id","workspace_id","case_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_scope_template_fk" FOREIGN KEY ("tenant_id","workspace_id","template_id") REFERENCES "public"."approval_templates"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_scope_policy_version_fk" FOREIGN KEY ("tenant_id","workspace_id","policy_version_id") REFERENCES "public"."policy_versions"("tenant_id","workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_cases_thread_revision_unique" ON "approval_cases" USING btree ("thread_id","revision_number");--> statement-breakpoint
CREATE INDEX "approval_cases_workspace_lifecycle_created_idx" ON "approval_cases" USING btree ("workspace_id","lifecycle","created_at");--> statement-breakpoint
CREATE INDEX "approval_cases_workspace_action_digest_idx" ON "approval_cases" USING btree ("workspace_id","action_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_policies_scope_name_unique" ON "approval_policies" USING btree ("tenant_id","workspace_id","name");--> statement-breakpoint
CREATE INDEX "approval_policies_workspace_lifecycle_idx" ON "approval_policies" USING btree ("workspace_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_templates_scope_name_unique" ON "approval_templates" USING btree ("tenant_id","workspace_id","name");--> statement-breakpoint
CREATE INDEX "approval_templates_workspace_lifecycle_idx" ON "approval_templates" USING btree ("workspace_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_threads_agent_external_key_unique" ON "approval_threads" USING btree ("workspace_id","agent_principal_id","external_key");--> statement-breakpoint
CREATE INDEX "approval_threads_workspace_created_idx" ON "approval_threads" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_checkpoints_partition_to_sequence_unique" ON "audit_checkpoints" USING btree ("tenant_id","workspace_id","partition_key","to_sequence");--> statement-breakpoint
CREATE INDEX "audit_checkpoints_export_range_idx" ON "audit_checkpoints" USING btree ("tenant_id","workspace_id","partition_key","from_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_ledger_entries_partition_sequence_unique" ON "audit_ledger_entries" USING btree ("tenant_id","workspace_id","partition_key","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_ledger_entries_partition_hash_unique" ON "audit_ledger_entries" USING btree ("tenant_id","workspace_id","partition_key","entry_hash");--> statement-breakpoint
CREATE INDEX "audit_ledger_entries_export_range_idx" ON "audit_ledger_entries" USING btree ("tenant_id","workspace_id","partition_key","sequence");--> statement-breakpoint
CREATE INDEX "audit_ledger_entries_case_created_idx" ON "audit_ledger_entries" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_ledger_heads_partition_unique" ON "audit_ledger_heads" USING btree ("tenant_id","workspace_id","partition_key");--> statement-breakpoint
CREATE UNIQUE INDEX "case_stages_case_stage_key_unique" ON "case_stages" USING btree ("case_id","stage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "case_stages_case_stage_index_unique" ON "case_stages" USING btree ("case_id","stage_index");--> statement-breakpoint
CREATE INDEX "case_stages_open_deadline_idx" ON "case_stages" USING btree ("workspace_id","state","deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "command_idempotency_principal_route_key_unique" ON "command_idempotency" USING btree ("tenant_id","workspace_id","principal_id","method","canonical_route","idempotency_key");--> statement-breakpoint
CREATE INDEX "command_idempotency_expiry_idx" ON "command_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "context_items_workspace_scan_state_idx" ON "context_items" USING btree ("workspace_id","scan_state","created_at");--> statement-breakpoint
CREATE INDEX "context_items_workspace_digest_idx" ON "context_items" USING btree ("workspace_id","observed_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifest_items_manifest_position_unique" ON "context_manifest_items" USING btree ("manifest_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifest_items_manifest_item_unique" ON "context_manifest_items" USING btree ("manifest_id","context_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifests_case_unique" ON "context_manifests" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_manifests_case_digest_unique" ON "context_manifests" USING btree ("case_id","digest");--> statement-breakpoint
CREATE INDEX "context_manifests_workspace_digest_idx" ON "context_manifests" USING btree ("workspace_id","digest");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_case_sequence_unique" ON "decisions" USING btree ("case_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_case_actor_idempotency_unique" ON "decisions" USING btree ("case_id","actor_principal_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "decisions_stage_accepted_idx" ON "decisions" USING btree ("stage_id","accepted_at");--> statement-breakpoint
CREATE INDEX "decisions_workspace_actor_idx" ON "decisions" USING btree ("workspace_id","actor_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_runs_case_ladder_scope_step_unique" ON "escalation_runs" USING btree ("case_id","ladder_version","scope_key","step_index");--> statement-breakpoint
CREATE INDEX "escalation_runs_due_status_idx" ON "escalation_runs" USING btree ("workspace_id","status","due_at");--> statement-breakpoint
CREATE INDEX "execution_receipts_release_received_idx" ON "execution_receipts" USING btree ("release_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_releases_nonce_unique" ON "execution_releases" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "execution_releases_case_state_idx" ON "execution_releases" USING btree ("case_id","state");--> statement-breakpoint
CREATE INDEX "execution_releases_expiry_idx" ON "execution_releases" USING btree ("state","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_intent_attempt_unique" ON "notification_deliveries" USING btree ("intent_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_provider_request_unique" ON "notification_deliveries" USING btree ("provider","provider_request_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_active_retry_idx" ON "notification_deliveries" USING btree ("state","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intents_scope_dedupe_unique" ON "notification_intents" USING btree ("tenant_id","workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_intents_dispatch_idx" ON "notification_intents" USING btree ("workspace_id","state","created_at");--> statement-breakpoint
CREATE INDEX "notification_intents_case_recipient_idx" ON "notification_intents" USING btree ("case_id","recipient_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_scope_idempotency_unique" ON "outbox" USING btree ("tenant_id","workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "outbox" USING btree ("state","available_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_policy_version_unique" ON "policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE INDEX "policy_versions_workspace_created_idx" ON "policy_versions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_work_scope_work_key_unique" ON "schedule_work" USING btree ("tenant_id","workspace_id","work_key");--> statement-breakpoint
CREATE INDEX "schedule_work_claim_idx" ON "schedule_work" USING btree ("status","due_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "schedule_work_case_status_idx" ON "schedule_work" USING btree ("case_id","status");--> statement-breakpoint
CREATE INDEX "scheduled_decisions_due_status_idx" ON "scheduled_decisions" USING btree ("workspace_id","status","effective_at");--> statement-breakpoint
CREATE INDEX "scheduled_decisions_case_principal_idx" ON "scheduled_decisions" USING btree ("case_id","requesting_principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_participants_stage_principal_unique" ON "stage_participants" USING btree ("stage_id","principal_id");--> statement-breakpoint
CREATE INDEX "stage_participants_principal_status_idx" ON "stage_participants" USING btree ("workspace_id","principal_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_template_version_unique" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "template_versions_workspace_risk_created_idx" ON "template_versions" USING btree ("workspace_id","risk_class","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_audit_ledger_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_ledger_entries is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_ledger_entries_immutable"
BEFORE UPDATE OR DELETE ON "audit_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_audit_ledger_mutation"();
