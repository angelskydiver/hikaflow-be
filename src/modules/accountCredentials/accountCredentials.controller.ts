import { Body, Controller, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccountCredentialService } from './accountCredentials.service';
import { RegisterAccountCredentialRequestDto } from './dto/accountCredentials.request.dto';

@ApiTags('Account Credentials')
@Controller('accountCredentials')
export class AccountCredentialController {
  constructor(
    private readonly _accountCredentialService: AccountCredentialService,
  ) {}

  @ApiBearerAuth()
  @Post('/register')
  async Register(
    @Body() data: RegisterAccountCredentialRequestDto,
    @Request() req: any,
  ) {
    return await this._accountCredentialService.register(
      data,
      req.user.accountId,
    );
  }
}
