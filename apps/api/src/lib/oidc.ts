type OidcConfig = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
};

let cachedConfig: OidcConfig | null = null;
let cachedIssuer: string | null = null;

export function isOidcEnabled(): boolean {
  return Boolean(
    process.env["OIDC_ISSUER"] &&
      process.env["OIDC_CLIENT_ID"] &&
      process.env["OIDC_CLIENT_SECRET"],
  );
}

export async function getOidcConfig(): Promise<OidcConfig> {
  const issuer = process.env["OIDC_ISSUER"]!.replace(/\/$/, "");
  if (cachedConfig && cachedIssuer === issuer) {
    return cachedConfig;
  }

  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    jwks_uri: string;
  };

  cachedIssuer = issuer;
  cachedConfig = {
    issuer,
    authorizationEndpoint: data.authorization_endpoint,
    tokenEndpoint: data.token_endpoint,
    jwksUri: data.jwks_uri,
  };

  return cachedConfig;
}

export function getOidcRedirectUri(): string {
  const webUrl = (process.env["WEB_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
  return `${webUrl}/v1/auth/oidc/callback`;
}
