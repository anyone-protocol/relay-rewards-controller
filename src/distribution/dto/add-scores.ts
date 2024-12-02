import { ScoreData } from "../schemas/score-data"

export interface AddScoresData {
  [key: string]: Omit<ScoreData, 'Fingerprint'>
}

export interface AddScoresResult {
  result: boolean
  stamp: number
  scored: string[]
}
