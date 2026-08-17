/**
 * Navigation and prop types for the auth screen flow.
 *
 * Auth flow: Welcome → Register → VerifyEmail → BiometricSetup → Home
 *            Welcome → Login (System Browser) → Callback → BiometricSetup → Home
 */

/** Route names available in the auth flow */
export type AuthRoute =
  | 'Welcome'
  | 'Register'
  | 'VerifyEmail'
  | 'BiometricSetup';

/** Navigation param list for the auth stack */
export type AuthStackParamList = {
  Welcome: undefined;
  Register: undefined;
  VerifyEmail: { email: string };
  BiometricSetup: { userId: string };
};

/** Callback props for screens that trigger navigation externally */
export interface WelcomeScreenProps {
  onGetStarted?: () => void;
  onLogIn?: () => void;
}

/** Data collected by the Register screen before Keycloak auth */
export interface RegisterFormData {
  fullName: string;
  country: string;
  language: string;
}

/** Callback props for the Register screen */
export interface RegisterScreenProps {
  onContinue?: (data: RegisterFormData) => void;
}

/** Props for the VerifyEmail screen */
export interface VerifyEmailScreenProps {
  email?: string;
  onResend?: () => void;
  onVerified?: () => void;
}

/** Props for the BiometricSetup screen */
export interface BiometricSetupScreenProps {
  userId?: string;
  onSetupComplete?: () => void;
  onSkip?: () => void;
}

// ─── OAuth Types ─────────────────────────────────────────────────────────────

/** Tokens returned from the BidClean API callback endpoint */
export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
}

/** Response from POST /auth/callback */
export interface CallbackResponse {
  tokens: OAuthTokens;
  user: {
    id: string;
    keycloak_id: string;
    email: string;
    full_name: string;
    is_email_verified: boolean;
  };
}

/** Possible OAuth error types */
export type OAuthErrorCode =
  | 'user_cancelled'
  | 'network_error'
  | 'invalid_code'
  | 'token_exchange_failed'
  | 'unknown';

/** Structured OAuth error */
export interface OAuthError {
  code: OAuthErrorCode;
  message: string;
  details?: unknown;
}

/** Return type of the useOAuth hook */
export interface UseOAuthReturn {
  startLogin: () => Promise<CallbackResponse | null>;
  startRegistration: () => Promise<CallbackResponse | null>;
  isLoading: boolean;
  error: OAuthError | null;
}
