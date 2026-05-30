import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AdminKeyGuard } from './admin-key.guard';
import { DlqController } from './dlq.controller';

@Module({
  imports: [EventsModule],
  controllers: [DlqController],
  providers: [AdminKeyGuard],
})
export class DlqModule {}
