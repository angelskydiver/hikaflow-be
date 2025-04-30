import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from 'src/decorators/public';
import { BillingService } from '../billing/billing.service';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks') // Webhook routes will be prefixed with /webhooks
export class WebhooksController {
  constructor(
    private _webhooksService: WebhooksService,
    private _billingService: BillingService,
  ) {}
  // Simple POST method to handle the ping and log the body

  @Public()
  @Post('/github') // The route is /webhooks/ping
  async handlePing(@Body() body: any) {
    if (body.pull_request) {
      // Get repository to find organization ID
      const repository = await this._webhooksService.getRepositoryById(
        body.repository.id.toString(),
      );

      if (!repository || !repository.organizationId) {
        return {
          success: false,
          message:
            'Repository not found or not associated with an organization',
        };
      }

      // Check if PR evaluation is allowed
      const canEvaluate = await this._billingService.canEvaluatePullRequest(
        repository.organizationId,
      );
      if (!canEvaluate.allowed) {
        return { success: false, message: canEvaluate.message };
      }

      if (body.action == 'opened') {
        return await this._webhooksService.managePRs(body);
      } else if (body.action == 'closed' && body?.pull_request?.merged) {
        return await this._webhooksService.generatePrReport(body);
      } else if (body.action == 'synchronize') {
        return await this._webhooksService.syncPR(body);
      }
    } else {
      console.log('Request body:', body); // Log the body of the request
    }
    return {
      success: true,
    }; // Respond with 'Pong' when ping is received
  }

  @Public()
  @Post('/bitbucket') // The route is /webhooks/ping
  async handleBitbucketWebhooks(@Body() body: any) {
    if (body.event.includes('pullrequest')) {
      // Get repository to find organization ID
      const repository = await this._webhooksService.getRepositoryById(
        body.data.repository.uuid.toString(),
      );

      if (!repository || !repository.organizationId) {
        return {
          success: false,
          message:
            'Repository not found or not associated with an organization',
        };
      }

      // Check if PR evaluation is allowed
      const canEvaluate = await this._billingService.canEvaluatePullRequest(
        repository.organizationId,
      );
      if (!canEvaluate.allowed) {
        return { success: false, message: canEvaluate.message };
      }

      if (body.event == 'pullrequest:created') {
        return await this._webhooksService.bitbucketCreateRequest({
          ...body.data,
          event: body.event,
        });
      } else if (body.event == 'pullrequest:fulfilled') {
        return await this._webhooksService.generateBitbucketPrReport({
          ...body.data,
          event: body.event,
        });
      } else if (body.event == 'pullrequest:updated') {
        return await this._webhooksService.syncBitbucketPR({
          ...body.data,
          event: body.event,
        });
      }
    }
    return {
      success: true,
    }; // Respond with 'Pong' when ping is received
  }

  @Public()
  @Get('diffTesting')
  async DiffFunctionality() {
    return await this._webhooksService.syncPR(null);
  }
  //
}
