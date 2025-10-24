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

  private readonly MAX_RETRY_ATTEMPTS = 3;

  async trackPr(data: RegisterTrackerRequestDto) {
    try {
      const prTracker = await this._prismaService.prTracker.findMany({
        where: { prId: data.prId },
      });
      if (prTracker.length + 1 > this.MAX_RETRY_ATTEMPTS) {
        return { success: false };
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
      const tracker = await this._prismaService.prTracker.findFirst({
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
      const prs = await this._prismaService.prTracker.findMany({
        where: {
          status: PrTrackerStatus.REJECTED,
          try: { lt: 3 },
          createdAt: { lte: new Date(Date.now() - 1000 * 60 * 15) },
        },
      });
      if (!prs.length) return;
      console.log('Total Number of in complete PRs: ', prs.length);
      const prMapping = prs.map((body) => {
        const prIdParts = body.prId?.split('-') || [];
        const lastPart = prIdParts[prIdParts.length - 1];

        if (lastPart === 'opened') {
          return this._webhooksService.managePRs(body.response);
        } else if (
          lastPart === 'closed' &&
          body.response &&
          typeof body.response === 'object' &&
          'pull_request' in body.response &&
          body.response.pull_request &&
          typeof body.response.pull_request === 'object' &&
          'merged' in body.response.pull_request &&
          body.response.pull_request.merged
        ) {
          return this._webhooksService.generatePrReport(body.response);
        } else if (
          body.response &&
          typeof body.response === 'object' &&
          'action' in body.response &&
          body.response.action === 'synchronize'
        ) {
          return this._webhooksService.syncPR(body.response);
        }
        // for bitbucket
        else if (lastPart === 'pullrequest:created') {
          return this._webhooksService.bitbucketCreateRequest(body.response);
        } else if (lastPart === 'pullrequest:fulfilled') {
          return this._webhooksService.generateBitbucketPrReport(body.response);
        } else if (lastPart === 'pullrequest:updated') {
          return this._webhooksService.syncBitbucketPR(body.response);
        }

        // Return a resolved promise for unmatched cases to prevent undefined in Promise.all
        return Promise.resolve();
      });

      // Filter out any undefined values and await all promises
      const validPromises = prMapping.filter(
        (promise) => promise !== undefined,
      );
      await Promise.all(validPromises);
    } catch (error) {
      console.log(error);
      throw new Error('Failed to track PRs');
    }
  }
}
