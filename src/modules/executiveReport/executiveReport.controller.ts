import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Executive Report')
@Controller('executiveReport')
export class ExecutiveReportController {}
