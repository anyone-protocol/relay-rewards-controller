import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type ScoreDataDocument = HydratedDocument<ScoreData>

@Schema()
export class ScoreData {
    @Prop({ type: String, required: true })
    Address: string

    @Prop({ type: String, required: true })
    Fingerprint: string

    @Prop({ type: Number, required: true })
    Network: number
    
    @Prop({ type: Boolean, required: false, default: false })
    IsHardware?: boolean = false

    @Prop({ type: Number, required: false, default: 0 })
    UptimeStreak?: number = 0
    
    @Prop({ type: Number, required: false, default: 0 })
    FamilySize?: number = 0
    
    @Prop({ type: Number, required: false, default: 0 })
    LocationSize?: number = 0
}

export const ScoreDataSchema = SchemaFactory.createForClass(ScoreData)
