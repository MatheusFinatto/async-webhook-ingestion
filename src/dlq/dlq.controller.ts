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

@Controller('dlq')
@UseGuards(AdminKeyGuard)
export class DlqController {
  constructor(
    @InjectRepository(DlqMessage)
    private readonly dlqMessages: Repository<DlqMessage>,
    private readonly replayService: DlqReplayService,
  ) {}

  @Get()
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
  replay(@Param('id', ParseUUIDPipe) id: string): Promise<ReplayReceipt> {
    return this.replayService.replay(id);
  }
}
