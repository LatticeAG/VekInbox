import { SignJWT, jwtVerify } from "jose";

const EMAIL_TOKEN_MAX_AGE = 60 * 30; // 30 minutes

function getSecret(): Uint8Array {
  const secret = process.env["SESSION_SECRET"] ?? "dev-secret-change-in-production";
  return new TextEncoder().encode(secret);
}

export type EmailActionTokenPayload = {
  request_id: string;
  action: string;
  user_id: string;
};

export async function createEmailActionToken(
  payload: EmailActionTokenPayload,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EMAIL_TOKEN_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifyEmailActionToken(
  token: string,
): Promise<EmailActionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const requestId = payload["request_id"];
    const action = payload["action"];
    const userId = payload["user_id"];
    if (
      typeof requestId !== "string" ||
      typeof action !== "string" ||
      typeof userId !== "string"
    ) {
      return null;
    }
    return { request_id: requestId, action, user_id: userId };
  } catch {
    return null;
  }
}

export function buildEmailActionUrl(token: string): string {
  const base = process.env["WEB_URL"] ?? "http://localhost:3001";
  return `${base}/v1/actions/email?token=${encodeURIComponent(token)}`;
}
