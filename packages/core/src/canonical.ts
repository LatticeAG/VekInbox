import { createHash } from "node:crypto";

/** Values that can be represented in a stable, portable JSON form. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function canonicalize(value: unknown, seen: Set<object>): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Canonical JSON does not support invalid dates");
    }
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Canonical JSON does not support circular values");
    }
    seen.add(value);
    const result = value.map((entry) => canonicalize(entry, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Canonical JSON does not support circular values");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON only supports plain objects, arrays, and dates");
    }
    seen.add(value);
    const objectValue = value as Record<string, unknown>;
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(objectValue).sort()) {
      const entry = objectValue[key];
      if (entry === undefined) {
        throw new TypeError(`Canonical JSON does not support undefined at '${key}'`);
      }
      result[key] = canonicalize(entry, seen);
    }
    seen.delete(value);
    return result;
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

/**
 * Produces deterministic JSON by recursively sorting object keys. It deliberately
 * rejects lossy JavaScript values instead of silently changing an approval digest.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digestCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Normalizes the two digest spellings used by the v1/v3 boundaries.  Internal
 * core state keeps the compact 64-character hexadecimal form, while public
 * contracts may use the explicit `sha256:` prefix from the v3 specification.
 */
export function normalizeSha256Digest(value: string): string {
  const digest = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw new TypeError("Expected a SHA-256 digest (64 hexadecimal characters, optionally prefixed with sha256:)");
  }
  return digest.toLowerCase();
}

/** Formats a verified digest for wire-facing v3 contracts. */
export function formatSha256Digest(value: string): string {
  return `sha256:${normalizeSha256Digest(value)}`;
}

export function isSha256Digest(value: string): boolean {
  try {
    normalizeSha256Digest(value);
    return true;
  } catch {
    return false;
  }
}

/** A deep copy suitable for returning domain state without leaking internal references. */
export function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
