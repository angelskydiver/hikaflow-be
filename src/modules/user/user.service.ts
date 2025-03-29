import { BadRequestException, Injectable } from '@nestjs/common';
import { User, UserLoginType } from '@prisma/client';
// import { hashPassword, comparePasswords } from '../../utils/bcrypt.utils'; // Import bcrypt utils
import { JwtService } from '@nestjs/jwt';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { hashPassword } from 'src/utils/bcrypt.util';
import { AccountService } from '../account/account.service';
import { VerificationCodeService } from '../verificationCode/verificationCode.service';
import {
  CreateUserRequestDto,
  VerificationRequestDto,
  VerifyEmailRequestDto,
  VerifyPasswordRequestDto,
} from './dto/userRequest.dto';

@Injectable()
export class UserService {
  constructor(
    private _prismaService: PrismaService,
    private readonly _accountService: AccountService,
    private readonly _jwtService: JwtService,
    private readonly _verificationCodeService: VerificationCodeService,
    private readonly _mailService: MailService,
  ) {}

  // Register a new user
  async createUser(data: CreateUserRequestDto): Promise<User> {
    try {
      let { firstName, lastName, email, password } = data;
      let IsUserExist = await this._prismaService.user.count({
        where: { email },
      });
      if (IsUserExist > 0) {
        throw new BadRequestException('Email already exists');
      }

      const hashedPassword = await hashPassword(password); // Hash the password
      let User = await this._prismaService.user.create({
        data: {
          firstName,
          lastName,
          email,
          password: hashedPassword, // Store the hashed password
          loginType: UserLoginType.CUSTOM, // Or use your default value logic
        },
      });

      await this._accountService.createAccount({ userId: User.id });
      await this.verificationCode({ email: data.email });
      return User;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async login(User: User | any) {
    // let { _doc, ...others } = User;
    // let Account: Account = await this._prismaService.account.findUnique({
    //   where: { userId: User.id },
    // });
    let accountCreds = await this._prismaService.accountCredentials.findFirst({
      where: { accountId: User?.account?.id },
    });
    User.account['gitConnected'] = Boolean(accountCreds);
    const payload = {
      accountId: User?.account?.id,
      userId: User.id,
      verified: User?.account?.verified,
    };
    let isInvited = await this._prismaService.organizationInvitation.findFirst({
      where: {
        email: User.email,
      },
    });

    let isOrgMember = await this._prismaService.organizationAccounts.findFirst({
      where: {
        accountId: User?.account?.id,
        role: { not: 'ADMIN' },
      },
    });

    return {
      user: User,
      account: User?.account?.id,
      verified: User?.account?.verified,
      access_token: await this._jwtService.signAsync(payload),
      isInvited: {
        isInvited: isInvited || isOrgMember,
        organizationId: isInvited?.organizationId || null,
      },
    };
  }

  // Compare passwords during login
  async validateUser(data: {
    email: string;
    plainPassword: string;
  }): Promise<User> {
    let { email, plainPassword } = data;
    const User = await this._prismaService.user.findUnique({
      where: { email },
      include: { account: true },
    });

    if (!User) {
      throw new BadRequestException('User not found');
    }

    // const isPasswordValid = await comparePasswords(
    //   plainPassword,
    //   User.password,
    // ); // Compare the hashed password

    // if (!isPasswordValid) {
    //   throw new BadRequestException('Invalid credentials');
    // }

    return User;
  }

  async getUserInfo(userId: string) {
    try {
      return await this._prismaService.user.findUnique({
        where: { id: userId },
        include: { account: true },
      });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async verificationCode(data: VerificationRequestDto) {
    try {
      let user = await this._prismaService.user.findUnique({
        where: { email: data.email },
        include: { account: true },
      });
      if (!user) {
        throw new BadRequestException('User not found');
      }
      // send code to the user
      let { code } = await this._verificationCodeService.createCode(
        user.account.id,
      );
      let payload = {
        email: user.email,
        name: user.firstName,
        otp: code,
      };
      await this._mailService.verifyEmail(payload);
      return {
        success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async verifyEmail(data: VerifyEmailRequestDto) {
    try {
      let user = await this._prismaService.user.findUnique({
        where: { email: data.email },
        include: { account: true },
      });
      let isCodeVerified = await this._verificationCodeService.validateCode(
        user.account.id,
        data.code,
      );
      await this._prismaService.user.update({
        where: {
          id: user.id, // Find the user by their unique ID
        },
        data: {
          verified: true, // Set the 'verified' field to true
        },
      });

      await this._accountService.updateAccount(user.account.id, {
        verified: true,
      });

      const payload = {
        accountId: user?.account?.id,
        userId: user?.id,
        verified: true,
      };

      let isInvited =
        await this._prismaService.organizationInvitation.findFirst({
          where: {
            email: user.email,
          },
        });

      return {
        user: user,
        account: user?.account?.id,
        verified: true,
        access_token: await this._jwtService.signAsync(payload),
        isInvited: {
          isInvited,
          organizationId: isInvited?.organizationId || null,
        },
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async setNewPassword(data: VerifyPasswordRequestDto) {
    try {
      let user = await this._prismaService.user.findUnique({
        where: { email: data.email },
        include: { account: true },
      });
      await this._verificationCodeService.validateCode(
        user.account.id,
        data.code,
      );
      const hashedPassword = await hashPassword(data.newPassword); // Hash the password
      await this._prismaService.user.update({
        where: {
          id: user.id, // Find the user by their unique ID
        },
        data: {
          password: hashedPassword, // Set the 'verified' field to true
        },
      });

      const payload = {
        accountId: user?.account?.id,
        userId: user?.id,
      };

      return {
        user: user,
        account: user?.account?.id,
        access_token: await this._jwtService.signAsync(payload),
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
