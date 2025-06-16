import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../decorators/public';
import { JwtAuthGuard } from '../../passport/guards/jwt.guard';
import { LocalAuthGuard } from '../../passport/guards/local.guard';
import { UserTaskProgressDto } from './dto/user.task-progress.dto';
import {
  CreateUserRequestDto,
  LoginRequestDto,
  VerificationRequestDto,
  VerifyEmailRequestDto,
  VerifyPasswordRequestDto,
} from './dto/userRequest.dto';
import { UserService } from './user.service';

@ApiTags('users') // Tag the controller
@Controller('users')
export class UserController {
  constructor(private readonly _userService: UserService) {}

  @Public()
  @Post('register')
  async createUser(@Body() createUserDto: CreateUserRequestDto) {
    return await this._userService.createUser(createUserDto);
  }

  @Public()
  @Post('verificationCode')
  async VerificationCode(@Body() data: VerificationRequestDto) {
    return await this._userService.verificationCode(data);
  }

  @Public()
  @Post('verifyEmail')
  async VerifyEmail(@Body() data: VerifyEmailRequestDto) {
    return await this._userService.verifyEmail(data);
  }

  @Public()
  @Post('updatePassword')
  async SetNewPassword(@Body() data: VerifyPasswordRequestDto) {
    return await this._userService.setNewPassword(data);
  }

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  async Login(@Body() data: LoginRequestDto, @Request() req: any) {
    const user = await this._userService.login(req.user);
    return user;
  }

  @ApiBearerAuth()
  @Get('getUserInfo')
  async GetUserInfo(@Request() req: any) {
    return await this._userService.getUserInfo(req.user.userId);
  }

  @Get('task-progress')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getUserTaskProgress(@Request() req): Promise<UserTaskProgressDto> {
    return this._userService.getUserTaskProgress(req.user.accountId);
  }
}
