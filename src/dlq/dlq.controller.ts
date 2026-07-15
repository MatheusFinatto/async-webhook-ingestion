import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DlqMessage } from '../events/entities/dlq-message.entity';
import { AdminKeyGuard } from './admin-key.guard';
import { DlqQueryDto } from './dlq-query.dto';
import { DlqReplayService, ReplayReceipt } from './dlq-replay.service';

interface DlqPage {
  data: DlqMessage[];
  page: number;
  limit: number;
  total: number;
}

@ApiTags('dlq')
@ApiSecurity('admin-key')
@ApiResponse({ status: 401, description: 'Missing admin key' })
@ApiResponse({ status: 403, description: 'Invalid admin key' })
@Controller('dlq')
@UseGuards(AdminKeyGuard)
export class DlqController {
  constructor(
    @InjectRepository(DlqMessage)
    private readonly dlqMessages: Repository<DlqMessage>,
    private readonly replayService: DlqReplayService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List dead-lettered messages',
    description:
      'Newest first. replayed_at records the last redrive of each entry.',
  })
  @ApiResponse({ status: 200, description: 'One page of dead letters' })
  async list(@Query() query: DlqQueryDto): Promise<DlqPage> {
    const [data, total] = await this.dlqMessages.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { data, page: query.page, limit: query.limit, total };
  }

  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay a dead letter',
    description:
      'Resets the event state, republishes the original message and restarts the retry budget. The dead-letter row is kept with a replayed_at stamp.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'dlq_messages.id' })
  @ApiResponse({ status: 202, description: 'Redrive confirmed by the broker' })
  @ApiResponse({ status: 404, description: 'Unknown dead letter' })
  @ApiResponse({
    status: 409,
    description:
      'Not replayable: no event id, event already processed or in flight',
  })
  @ApiResponse({
    status: 503,
    description: 'Broker did not confirm the redrive; safe to retry',
  })
  replay(@Param('id', ParseUUIDPipe) id: string): Promise<ReplayReceipt> {
    return this.replayService.replay(id);
  }
}
