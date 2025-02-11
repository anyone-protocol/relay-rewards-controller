export default interface ScoringDetails {
  Address: string
  Score: {
    Network: number
    IsHardware: boolean
    UptimeStreak: number
    ExitBonus: boolean
    FamilySize: number
    LocationSize: number
  }
  Variables: { FamilyMultiplier: number; LocationMultiplier: number }
  Rating: { Network: number; Uptime: number; ExitBonus: number }
  Reward: {
    Total: string
    OperatorTotal: string
    DelegateTotal: string
    Network: string
    Hardware: string
    Uptime: string
    ExitBonus: string
  }
}
