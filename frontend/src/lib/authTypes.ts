export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  session_id: string
}
export interface IdentitySnapshot {
  epoch: number
  sessionId: string
  userId: string
  requestGeneration: number
}
export type AuthPhase = 'anonymous' | 'authenticating' | 'identifying' | 'authenticated'
  | 'identityError' | 'loggingOut' | 'logoutUncertain' | 'revalidating' | 'restoring' | 'restoreError'
export interface AuthSnapshot {
  phase: AuthPhase
  sessionId: string | null
  userId: string | null
  epoch: number
  requestGeneration: number
  error: string | null
}
export interface AuthTransport {
  login(input: { email: string; password: string }, signal: AbortSignal): Promise<TokenResponse>
  refresh(sid: string, signal: AbortSignal): Promise<TokenResponse>
  logout(sid: string, signal: AbortSignal): Promise<unknown>
}
