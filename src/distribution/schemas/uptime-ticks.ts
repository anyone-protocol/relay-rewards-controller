import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type UptimeTicksDocument = HydratedDocument<UptimeTicks>

@Schema()
export class UptimeTicks {
  @Prop({ type: String, required: true })
  fingerprint: string

  @Prop({ type: Number, required: true })
  stamp: number
}

export const UptimeTicksSchema = SchemaFactory.createForClass(UptimeTicks)
