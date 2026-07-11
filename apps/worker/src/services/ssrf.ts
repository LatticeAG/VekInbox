import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    return true;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) {
      return isPrivateIpv4(mapped);
    }
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

export async function assertSafeWebhookUrl(urlString: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook URL must use HTTP or HTTPS");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("Webhook URL targets a blocked host");
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Webhook URL targets a private IP address");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new Error(`Webhook URL resolves to private IP: ${addr.address}`);
    }
  }
}
