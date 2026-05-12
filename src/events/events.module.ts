import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DlqMessage } from './entities/dlq-message.entity';
import { Event } from './entities/event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Event, DlqMessage])],
  exports: [TypeOrmModule],
})
export class EventsModule {}
