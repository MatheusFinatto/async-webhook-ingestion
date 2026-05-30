import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DlqMessage } from '../events/entities/dlq-message.entity';
import { AdminKeyGuard } from './admin-key.guard';
import { DlqQueryDto } from './dlq-query.dto';

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
}
