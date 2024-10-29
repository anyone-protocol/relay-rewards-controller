import ScoringDetails from "./scoring-details"

export default interface RoundData {
    Timestamp: number // millis
    Period: number // seconds
    Details: {
        [key: string]: ScoringDetails
    }
}
