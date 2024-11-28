export default interface Configuration {
  TokensPerSecond: number
  Modifiers: {
    Network: { Share: number }
    Hardware: { Enabled: boolean; Share: number; UptimeInfluence: number }
    Uptime: {
      Enabled: boolean
      Share: number
      Tiers: { [key: string]: number }[]
    }
    ExitBonus: { Enabled: boolean; Share: number }
  }
  Multipliers: {
    Family: { Enabled: boolean; Offset: number; Power: number }
    Location: { Enabled: boolean; Offset: number; Power: number }
  }
  Delegates: { [key: string]: { Address: string; Share: number } }
}
