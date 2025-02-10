import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { PrTrackerStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { RegisterTrackerRequestDto } from './dto/prTracker.request.dto';

@Injectable()
export class PrTrackerService {
  constructor(
    private _prismaService: PrismaService,
    @Inject(forwardRef(() => WebhooksService))
    private _webhooksService: WebhooksService,
  ) {}

  async trackPr(data: RegisterTrackerRequestDto) {
    try {
      let prTracker = await this._prismaService.prTracker.findMany({
        where: { prId: data.prId },
      });
      if (prTracker.length + 1 > 3) {
        return;
      }
      if (prTracker.length) {
        await this._prismaService.prTracker.update({
          where: { id: prTracker[0].id },
          data: { try: prTracker.length + 1 },
        });
      } else {
        await this._prismaService.prTracker.create({
          data: { ...data, try: prTracker.length + 1 },
        });
      }
      return { success: true };
    } catch (error) {
      console.log(error.message);
      throw new Error('Failed to track PR');
    }
  }

  async updatePrInfo(prId: string, status: PrTrackerStatus) {
    try {
      let tracker = await this._prismaService.prTracker.findFirst({
        where: { prId },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!tracker) throw new Error('Tracker not found');

      await this._prismaService.prTracker.update({
        where: { id: tracker?.id },
        data: { status },
      });
    } catch (error) {
      console.log(error.message);
      throw new Error('Failed to update PR status');
    }
  }

  async trackPrs() {
    try {
      let prs = await this._prismaService.prTracker.findMany({
        where: { status: PrTrackerStatus.REJECTED, try: { lt: 3 } },
      });
      if (!prs.length) return;
      console.log('Total Number of in complete PRs: ', prs.length);
      let prMapping = prs.map((body) => {
        // @ts-ignore
        if (body.response?.action == 'opened') {
          return this._webhooksService.managePRs(body.response);
        } else if (
          // @ts-ignore
          body.response?.action == 'closed' &&
          // @ts-ignore
          body.response?.pull_request?.merged
        ) {
          return this._webhooksService.generatePrReport(body.response);
          // @ts-ignore
        } else if (body.response?.action == 'synchronize') {
          return this._webhooksService.syncPR(body.response);
        }
      });
      await Promise.all(prMapping);
    } catch (error) {
      console.log(error);
      throw new Error('Failed to track PRs');
    }
  }
}
