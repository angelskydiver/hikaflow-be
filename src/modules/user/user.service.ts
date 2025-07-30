import { BadRequestException, Injectable } from '@nestjs/common';
import { User, UserLoginType } from '@prisma/client';
// import { hashPassword, comparePasswords } from '../../utils/bcrypt.utils'; // Import bcrypt utils
import { JwtService } from '@nestjs/jwt';
import { CommentType } from '@prisma/client';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { hashPassword } from 'src/utils/bcrypt.util';
import { AccountService } from '../account/account.service';
import { VerificationCodeService } from '../verificationCode/verificationCode.service';
import { UserTaskProgressDto } from './dto/user.response.dto';
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
      const { firstName, lastName, email, password, partnerId } = data;
      const IsUserExist = await this._prismaService.user.count({
        where: { email },
      });
      if (IsUserExist > 0) {
        throw new BadRequestException('Email already exists');
      }

      // If partnerId provided, verify the affiliate exists
      if (partnerId) {
        const affiliateExists =
          await this._prismaService.affiliateUser.findUnique({
            where: { id: partnerId },
          });
        if (!affiliateExists) {
          throw new BadRequestException('Invalid partner ID');
        }
      }

      const hashedPassword = await hashPassword(password); // Hash the password
      const User = await this._prismaService.user.create({
        data: {
          firstName,
          lastName,
          email,
          password: hashedPassword, // Store the hashed password
          loginType: UserLoginType.CUSTOM, // Or use your default value logic
        },
      });

      await this._accountService.createAccount({ userId: User.id });

      // Create referral relationship if partnerId provided
      if (partnerId) {
        await this._prismaService.userReferral.create({
          data: {
            affiliateUserId: partnerId,
            userId: User.id,
            registrationDate: new Date(),
            isActive: true,
          },
        });
      }

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
    const accountCreds = await this._prismaService.accountCredentials.findFirst(
      {
        where: { accountId: User?.account?.id },
      },
    );
    User.account['gitConnected'] = Boolean(accountCreds);
    const payload = {
      accountId: User?.account?.id,
      userId: User.id,
      verified: User?.account?.verified,
    };
    const isInvited =
      await this._prismaService.organizationInvitation.findFirst({
        where: {
          email: User.email,
        },
      });

    const isOrgMember =
      await this._prismaService.organizationAccounts.findFirst({
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
    const { email, plainPassword } = data;
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
      const user = await this._prismaService.user.findUnique({
        where: { email: data.email },
        include: { account: true },
      });
      if (!user) {
        throw new BadRequestException('User not found');
      }
      // send code to the user
      const { code } = await this._verificationCodeService.createCode(
        user.account.id,
      );
      const payload = {
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
      const user = await this._prismaService.user.findUnique({
        where: { email: data.email },
        include: { account: true },
      });
      const isCodeVerified = await this._verificationCodeService.validateCode(
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

      const isInvited =
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
      const user = await this._prismaService.user.findUnique({
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

  async getUserTaskProgress(accountId: string): Promise<UserTaskProgressDto> {
    const account = await this._prismaService.account.findUnique({
      where: { id: accountId },
      include: {
        accountCredentials: true,
        accountOrganization: {
          include: {
            organization: {
              include: {
                repositories: {
                  include: {
                    scan: true,
                    AssistedQuestions: true,
                    comments: {
                      where: {
                        type: CommentType.PULL_REQUEST,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!account) {
      throw new Error('Account not found');
    }

    const hasConnectedGit = account.accountCredentials ? true : false;
    const hasCreatedOrganization = account.accountOrganization?.length > 0;
    const hasConnectedRepository = account.accountOrganization?.some(
      (org) => org.organization.repositories?.length > 0,
    );
    const hasScannedRepository = account.accountOrganization?.some((org) =>
      org.organization.repositories?.some((repo) => repo.scan?.length > 0),
    );
    const hasAskedQuestion = account.accountOrganization?.some((org) =>
      org.organization.repositories?.some(
        (repo) => repo.AssistedQuestions?.length > 0,
      ),
    );
    const prCount =
      account.accountOrganization?.reduce(
        (count, org) =>
          count +
          org.organization.repositories?.reduce(
            (repoCount, repo) => repoCount + (repo.comments?.length || 0),
            0,
          ),
        0,
      ) || 0;

    const totalTasks = 6;
    const completedTasks = [
      hasConnectedGit,
      hasCreatedOrganization,
      hasConnectedRepository,
      hasScannedRepository,
      hasAskedQuestion,
      prCount >= 3,
    ].filter(Boolean).length;

    const progressPercentage = Math.round((completedTasks / totalTasks) * 100);

    return {
      hasConnectedGit,
      hasCreatedOrganization,
      hasConnectedRepository,
      hasScannedRepository,
      hasAskedQuestion,
      prCount,
      progressPercentage,
      discountClaimed: progressPercentage === 100,
    };
  }
}
