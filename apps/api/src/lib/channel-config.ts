const SENSITIVE_CONFIG_KEY =
  /(?:api[_-]?key|token|secret|password|authorization|signing|webhook(?:[_-]?url)?)/i;

/**
 * Channel configuration can contain provider credentials. Keep the persisted
 * configuration intact for workers, but never return credential-shaped values
 * from the browser-facing channel endpoints.
 */
export function redactChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, redactConfigValue(key, value)]),
  );
}

function redactConfigValue(key: string, value: unknown): unknown {
  if (SENSITIVE_CONFIG_KEY.test(key)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? redactChannelConfig(item as Record<string, unknown>)
        : item,
    );
  }

  if (value && typeof value === "object") {
    return redactChannelConfig(value as Record<string, unknown>);
  }

  return value;
}
