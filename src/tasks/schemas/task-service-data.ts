import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type TaskServiceDataDocument = HydratedDocument<TaskServiceData>

@Schema()
export class TaskServiceData {
  @Prop({ type: Number, required: true })
  startedAt: number

  @Prop({ type: Boolean, default: false })
  complete: boolean

  @Prop({ type: Boolean, default: false })
  persisted: boolean
}

export const TaskServiceDataSchema = SchemaFactory.createForClass(TaskServiceData)
