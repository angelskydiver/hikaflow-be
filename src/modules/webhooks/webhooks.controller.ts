import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from 'src/decorators/public';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks') // Webhook routes will be prefixed with /webhooks
export class WebhooksController {
  constructor(private _webhooksService: WebhooksService) {}
  // Simple POST method to handle the ping and log the body

  @Public()
  @Post('/ping') // The route is /webhooks/ping
  async handlePing(@Body() body: any) {
    console.log('Ping received!');
    console.log('Request body:', body); // Log the body of the request
    if (body.pull_request) {
      console.log(
        "body.action != 'closed' && body?.pull_request?.merged: ",
        body.action == 'closed' && body?.pull_request?.merged,
      );
      if (body.action == 'opened') {
        return await this._webhooksService.managePRs(body);
      } else if (body.action == 'closed' && body?.pull_request?.merged) {
        return await this._webhooksService.generatePrReport(body);
      } else if (body.action == 'synchronize') {
      }
    }
    return 'Pong'; // Respond with 'Pong' when ping is received
  }

  @Public()
  @Get('diffTesting')
  async DiffFunctionality() {
    return await this._webhooksService.generatePrReport();
  }
  //
}
