import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from 'src/decorators/public';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks') // Webhook routes will be prefixed with /webhooks
export class WebhooksController {
  constructor(private _webhooksService: WebhooksService) {}
  // Simple POST method to handle the ping and log the body

  @Public()
  @Post('/github') // The route is /webhooks/ping
  async handlePing(@Body() body: any) {
    if (body.pull_request) {
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
      if (body.event == 'pullrequest:created') {
        return await this._webhooksService.bitbucketCreateRequest(body.data);
      } else if (body.event == 'pullrequest:fulfilled') {
        return await this._webhooksService.generateBitbucketPrReport(body.data);
      } else if (body.event == 'pullrequest:updated') {
        return await this._webhooksService.syncBitbucketPR(body.data);
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
