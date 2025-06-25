import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartnerProgramLocalAuthGuard } from 'src/passport/guards/partner-program.local.guard';
import { Public } from '../../decorators/public';
import { AffiliateUserService } from './affiliateUser.service';
import {
  CreateAffiliateUserRequestDto,
  LoginAffiliateUserRequestDto,
  UpdateProfileRequestDto,
  VerificationRequestDto,
  VerifyEmailRequestDto,
  VerifyPasswordRequestDto,
} from './dto/affiliateUser.request.dto';

@ApiTags('affiliate-users')
@Controller('affiliate-users')
export class AffiliateUserController {
  constructor(private readonly _affiliateUserService: AffiliateUserService) {}

  @Public()
  @Post('register')
  async createAffiliateUser(
    @Body() createUserDto: CreateAffiliateUserRequestDto,
  ) {
    return await this._affiliateUserService.createAffiliateUser(createUserDto);
  }

  @Public()
  @Post('verificationCode')
  async VerificationCode(@Body() data: VerificationRequestDto) {
    return await this._affiliateUserService.verificationCode(data);
  }

  @Public()
  @Post('verifyEmail')
  async VerifyEmail(@Body() data: VerifyEmailRequestDto) {
    return await this._affiliateUserService.verifyEmail(data);
  }

  @Public()
  @Post('updatePassword')
  async SetNewPassword(@Body() data: VerifyPasswordRequestDto) {
    return await this._affiliateUserService.setNewPassword(data);
  }

  @Public()
  @UseGuards(PartnerProgramLocalAuthGuard)
  @Post('login')
  async Login(@Body() data: LoginAffiliateUserRequestDto, @Request() req: any) {
    const user = await this._affiliateUserService.login(req.user);
    return user;
  }

  @ApiBearerAuth()
  @Get('getUserInfo')
  async GetUserInfo(@Request() req: any) {
    return await this._affiliateUserService.getAffiliateUserInfo(
      req.user.userId,
    );
  }

  @ApiBearerAuth()
  @Post('update-profile')
  async UpdateProfile(
    @Body() updateProfileDto: UpdateProfileRequestDto,
    @Request() req: any,
  ) {
    return await this._affiliateUserService.updateProfile(
      req.user.userId,
      updateProfileDto,
    );
  }

  @Public()
  @Get('info/:affiliateId')
  async GetAffiliateUserById(@Param('affiliateId') affiliateId: string) {
    return await this._affiliateUserService.getAffiliateUserById(affiliateId);
  }

  @ApiBearerAuth()
  @Get('referred-users')
  async GetReferredUsers(@Request() req: any) {
    return await this._affiliateUserService.getReferredUsers(req.user.userId);
  }

  @ApiBearerAuth()
  @Get('dashboard-stats')
  async GetDashboardStats(@Request() req: any) {
    return await this._affiliateUserService.getDashboardStats(req.user.userId);
  }

  @ApiBearerAuth()
  @Get('user-activities/:userId')
  async GetUserActivities(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    return await this._affiliateUserService.getUserActivities(
      userId,
      req.user.userId,
    );
  }
}
