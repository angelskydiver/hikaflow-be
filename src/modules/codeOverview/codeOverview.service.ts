import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CodeOverviewRequestDto } from './dto/codeOverview.request.dto';

@Injectable()
export class CodeOverviewService {
  constructor(private _prismaService: PrismaService) {}

  async createCodeOverview(data: CodeOverviewRequestDto): Promise<any> {
    try {
      await this._prismaService.codeOverview.create({ data });
      return {
        success: true,
      };
    } catch (error) {
      console.error(error.message);
      throw new Error('Failed to create code overview');
    }
  }
}
