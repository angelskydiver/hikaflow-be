import { Body, Controller, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public';
import { AccountCredentialService } from './accountCredentials.service';
import {
  RegisterAccountCredentialRequestDto,
  RegisterBitbucketAccountCredentialRequestDto,
} from './dto/accountCredentials.request.dto';

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

  @Public()
  @Post('/register/bitbucketSecret')
  async RegisterBitbucketSecret(
    @Body() data: RegisterBitbucketAccountCredentialRequestDto,
  ) {
    try {
      await this._accountCredentialService.registerBitbucketSecret(data);
    } catch (error) {
      console.log(error);
      throw new Error('Failed to register Bitbucket secret');
    }
  }

  @Public()
  @Post('/store/bitbucketToken')
  async StoreBitbucketToken(@Body() data: any) {
    try {
      return await this._accountCredentialService.storeBitbucketToken(data);
    } catch (error) {
      console.log(error);
      throw new Error('Failed to store Bitbucket token');
    }
  }
}
