import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExecutiveReportRequestDto } from './dto/executiveReport.request.dto';

@Injectable()
export class ExecutiveReportService {
  constructor(private _prismaService: PrismaService) {}

  async createExecutiveReport(data: ExecutiveReportRequestDto): Promise<any> {
    try {
      let report = await this._prismaService.executiveReport.create({
        data,
      });
      return {
        report: report,
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getExecutiveReportById(id) {
    try {
      let report = await this._prismaService.executiveReport.findUnique({
        where: { id },
        include: { repository: true, codeOverview: true },
      });

      if (!report) {
        throw new BadRequestException('Report not found');
      }
      return {
        ...report,
        codeReview: report.codeOverview.length
          ? report.codeOverview[report.codeOverview.length - 1]
          : null,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
