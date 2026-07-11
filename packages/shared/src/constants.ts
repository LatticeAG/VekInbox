export const API_VERSION = "0.1.0";

export const REQUEST_STATUSES = [
  "pending",
  "approved",
  "declined",
  "timed_out",
  "escalated",
  "cancelled",
  "changes_requested",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

export const STANDARD_ACTIONS = ["approve", "decline", "request_changes"] as const;
export type StandardAction = (typeof STANDARD_ACTIONS)[number];

export const MEMBERSHIP_ROLES = ["owner", "admin", "reviewer", "viewer"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const API_KEY_PREFIXES = ["vk_live_", "vk_test_"] as const;

export const MAX_METADATA_SIZE = 32_768;
export const MAX_DESCRIPTION_SIZE = 20_480;
export const MAX_TITLE = 200;
export const MAX_ACTIONS_PER_REQUEST = 8;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
export const API_KEY_PREFIX_LENGTH = 12;
export const API_KEY_LIVE_PREFIX = "vk_live_";
export const API_KEY_TEST_PREFIX = "vk_test_";
