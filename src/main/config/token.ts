import { randomBytes } from 'node:crypto'

/** 32 random bytes encoded as URL-safe base64 (43 characters). */
export function generatePairingToken(): string {
  return randomBytes(32).toString('base64url')
}
