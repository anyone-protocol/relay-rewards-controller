import { isHexStringValid } from './hex-string'

export function isAddressValid(address?: string) {
  if (!address) {
    return false
  }
  if (address.length !== 40) {
    return false
  }
  if (!isHexStringValid(address, true)) {
    return false
  }

  return true
}
