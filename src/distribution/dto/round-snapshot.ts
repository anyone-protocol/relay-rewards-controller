import Configuration from './configuration'
import ScoringDetails from './scoring-details'

export default interface RoundSnapshot {
  Timestamp: number // millis
  Period: number // seconds
  Summary: {
    Ratings: {
      ExitBonus: string
      Uptime: string
      Network: string
    }
    Rewards: {
      Uptime: string
      Network: string
      Hardware: string
      ExitBonus: string
      Total: string
    }
  }
  Configuration: Configuration
  Details: {
    [key: string]: ScoringDetails
  }
}
