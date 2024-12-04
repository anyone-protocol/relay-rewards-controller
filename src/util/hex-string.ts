export const UPPER_HEX_CHARS = '0123456789ABCDEF'
export const HEX_CHARS = `0123456789ABCDEFabcdef`

export function isHexStringValid(hex?: string, uppercase: boolean = false) {
  if (!hex) {
    return false
  }

  if (!hex.split('').every(c => (uppercase ? UPPER_HEX_CHARS : HEX_CHARS).includes(c))) {
    return false
  }

  return true
}
