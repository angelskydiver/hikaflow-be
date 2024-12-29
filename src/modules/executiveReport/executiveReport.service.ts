import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExecutiveReportRequestDto } from './dto/executiveReport.request.dto';

@Injectable()
export class ExecutiveReportService {
  constructor(private _prismaService: PrismaService) {}

  async createExecutiveReport(data: ExecutiveReportRequestDto): Promise<any> {
    try {
      await this._prismaService.executiveReport.create({ data });
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
