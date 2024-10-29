import Configuration from "./configuration"
import ScoringDetails from "./scoring-details"

export default interface RoundMetadata {
    Timestamp: number // millis
    Period: number // seconds
    Summary: {
        Total: number, Network: number, Hardware: number, Uptime: number, ExitBonus: number
    }
    Configuration: Configuration
}
