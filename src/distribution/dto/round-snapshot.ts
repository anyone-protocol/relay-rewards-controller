import Configuration from './configuration'
import ScoringDetails from './scoring-details'

export default interface RoundSnapshot {
  Timestamp: number // millis
  Period: number // seconds
  Summary: {
    Ratings: {
      ExitBonus: number
      Uptime: number
      Network: number
    }
    Rewards: {
      Uptime: number
      Network: number
      Hardware: number
      ExitBonus: number
      Total: number
    }
  }
  Configuration: Configuration
  Details: {
    [key: string]: ScoringDetails
  }
}
