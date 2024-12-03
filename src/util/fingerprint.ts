import { UPPER_HEX_CHARS } from './hex-string'

export function isFingerprintValid(fingerprint?: string) {
  if (!fingerprint) {
    return false
  }

  if (typeof fingerprint !== 'string') {
    return false
  }

  if (fingerprint.length !== 40) {
    return false
  }

  if (!fingerprint.split('').every((c) => UPPER_HEX_CHARS.includes(c))) {
    return false
  }

  return true
}
