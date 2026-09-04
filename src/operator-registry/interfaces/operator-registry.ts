/**
 * The slice of the operator-registry this service needs, as returned by that contract's
 * `scoring` view.
 *
 * Deliberately NOT the whole registry. The legacynet `View-State` dryrun pulled all five maps
 * and used two; `scoring` is the view the native contract added for exactly this consumer —
 * "the exact slice the reward runners + verifier need each round".
 *
 * Note `hardware`, not `verifiedHardware` — the view renames it. Legacy → native:
 *
 *   VerifiedFingerprintsToOperatorAddresses -> verified   (fingerprint -> operator address)
 *   VerifiedHardwareFingerprints            -> hardware   (fingerprint -> true)
 *
 * Address VALUES are EIP-55 checksummed post-migration; legacynet stored `0x`+ALLCAPS.
 * Fingerprint KEYS are unchanged.
 */
export interface OperatorRegistryScoring {
  /** fingerprint -> operator address (claimed/verified) */
  verified: { [fingerprint: string]: string }
  /** fingerprint -> true */
  hardware: { [fingerprint: string]: boolean }
}
