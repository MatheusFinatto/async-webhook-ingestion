import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AdminKeyGuard } from './admin-key.guard';
import { DlqController } from './dlq.controller';
import { DlqReplayService } from './dlq-replay.service';

@Module({
  imports: [EventsModule, MessagingModule],
  controllers: [DlqController],
  providers: [AdminKeyGuard, DlqReplayService],
})
export class DlqModule {}
