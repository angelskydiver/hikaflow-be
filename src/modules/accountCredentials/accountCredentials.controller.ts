import { Body, Controller, Post } from '@nestjs/common';
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
  Register(@Body() data: RegisterAccountCredentialRequestDto) {
    return this._accountCredentialService.register(data);
  }
}
