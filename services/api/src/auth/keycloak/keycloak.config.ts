/**
 * Keycloak configuration.
 * All values sourced from environment variables — nothing hardcoded.
 */
export interface KeycloakConfig {
  readonly baseUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
  readonly redirectUri: string;
}

export function getKeycloakConfig(): KeycloakConfig {
  return {
    baseUrl: process.env.KEYCLOAK_BASE_URL || 'http://localhost:8080',
    realm: process.env.KEYCLOAK_REALM || 'bidclean',
    clientId: process.env.KEYCLOAK_CLIENT_ID || 'bidclean-app',
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || '',
    adminUsername: process.env.KEYCLOAK_ADMIN_USERNAME || 'admin',
    adminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD || '',
    redirectUri:
      process.env.KEYCLOAK_MOBILE_REDIRECT_URI || 'bidclean://auth/callback',
  };
}
