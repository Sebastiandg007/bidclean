import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for the OAuth2 callback endpoint.
 * Validates the authorization code exchange request from the mobile client.
 */
export class CallbackDto {
  /** Authorization code received from Keycloak after user authenticates */
  @IsNotEmpty()
  @IsString()
  readonly code!: string;

  /** The redirect URI used in the original authorization request */
  @IsNotEmpty()
  @IsString()
  readonly redirectUri!: string;

  /** PKCE code_verifier that corresponds to the code_challenge sent during authorization */
  @IsNotEmpty()
  @IsString()
  readonly codeVerifier!: string;

  /** Device identifier for session tracking */
  @IsNotEmpty()
  @IsString()
  readonly deviceId!: string;
}
