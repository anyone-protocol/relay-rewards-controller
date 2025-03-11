import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type UptimeStreakDocument = HydratedDocument<UptimeStreak>

@Schema()
export class UptimeStreak {
  @Prop({ type: String, required: true })
  _id: string

  @Prop({ type: Number, required: true })
  start: number

  @Prop({ type: Number, required: true })
  last: number
}

export const UptimeStreakSchema = SchemaFactory.createForClass(UptimeStreak)
