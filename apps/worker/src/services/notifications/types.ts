/**
 * The v3 notification boundary deliberately models delivery separately from
 * approval. A provider may tell somebody about a case, but it never receives
 * enough authority to resolve it.
 */
export const NOTIFICATION_PROVIDER_KEYS = ["email", "slack", "sms"] as const;

export type NotificationProviderKey = (typeof NOTIFICATION_PROVIDER_KEYS)[number];

export const CONTENT_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

export type ContentClassification = (typeof CONTENT_CLASSIFICATIONS)[number];

export type ApprovalRiskClass = "R0" | "R1" | "R2" | "R3" | "R4";
export type NotificationUrgency = "normal" | "high" | "critical";

export interface NotificationEndpointSnapshot {
  /** Stable endpoint/version identifiers are retained by the authoritative delivery record. */
  id: string;
  version: number;
  provider: NotificationProviderKey;
  /** The provider destination. It must never be written to ordinary logs. */
  destination: string;
  verified: boolean;
  consented: boolean;
}

/**
 * This is an opaque navigation nonce, not an approval credential. Opening it
 * must lead to identity and policy checks in the VekInbox decision surface.
 */
export interface OpaqueProviderActionIntent {
  nonce: string;
  expiresAt: string;
}

export interface ApprovalNotification {
  deliveryId: string;
  intentId: string;
  caseId: string;
  stageId?: string;
  riskClass: ApprovalRiskClass;
  classification: ContentClassification;
  urgency: NotificationUrgency;
  expiresAt: string;
  /** Title and summary have already passed template/schema validation. */
  title: string;
  summary?: string;
  /** Only a public disclosure policy may render this outside the web inbox. */
  contextExcerpt?: string;
  /** Authenticated VekInbox deep link; never an approve/decline endpoint. */
  deepLink: string;
  actionIntent?: OpaqueProviderActionIntent;
}

export interface ProviderDeliveryInput {
  endpoint: NotificationEndpointSnapshot;
  notification: ApprovalNotification;
}

export type DeliveryState =
  | "accepted"
  | "delivered"
  | "failed_retryable"
  | "failed_terminal"
  | "suppressed";

export interface DeliveryOutcome {
  provider: NotificationProviderKey;
  deliveryId: string;
  state: DeliveryState;
  acceptedAt?: string;
  providerMessageId?: string;
  /** A normalised, non-sensitive error category. */
  errorCode?: string;
  retryAfterMs?: number;
  /** Safe provider facts only; never credentials, destination, or raw body. */
  providerMetadata?: Record<string, string | number | boolean>;
}

export interface ProviderCapabilities {
  endpointKinds: readonly string[];
  supportsDeliveryReceipts: boolean;
  supportsReadReceipts: boolean;
  supportsInboundActions: boolean;
  supportsThreadUpdates: boolean;
  maxPayloadBytes: number;
  /** Inline actions are always an intent, never final authorization. */
  allowedRiskForInlineAction: readonly ApprovalRiskClass[];
}

export interface NotificationProviderAdapter {
  readonly providerKey: NotificationProviderKey;
  readonly capabilities: ProviderCapabilities;
  readonly configured: boolean;
  deliver(input: ProviderDeliveryInput): Promise<DeliveryOutcome>;
  /** Provides a safe shape for operational logs and audit projections. */
  redactForLogs(input: ProviderDeliveryInput): Record<string, unknown>;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
