import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type TaskServiceDataDocument = HydratedDocument<TaskServiceData>

@Schema()
export class TaskServiceData {
    @Prop({ type: Boolean, default: false })
    isDistributing: boolean
}

export const TaskServiceDataSchema =
    SchemaFactory.createForClass(TaskServiceData)
