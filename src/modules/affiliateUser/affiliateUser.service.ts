import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AffiliateUser, UserLoginType } from '@prisma/client';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { comparePasswords, hashPassword } from 'src/utils/bcrypt.util';
import { VerificationCodeService } from '../verificationCode/verificationCode.service';
import {
  CreateAffiliateUserRequestDto,
  UpdateProfileRequestDto,
  VerificationRequestDto,
  VerifyEmailRequestDto,
  VerifyPasswordRequestDto,
} from './dto/affiliateUser.request.dto';

@Injectable()
export class AffiliateUserService {
  constructor(
    private _prismaService: PrismaService,
    private readonly _jwtService: JwtService,
    private readonly _verificationCodeService: VerificationCodeService,
    private readonly _mailService: MailService,
  ) {}

  // Register a new affiliate user
  async createAffiliateUser(
    data: CreateAffiliateUserRequestDto,
  ): Promise<AffiliateUser> {
    try {
      const { name, email, phoneNumber, password } = data;

      const isUserExist = await this._prismaService.affiliateUser.count({
        where: { email },
      });

      if (isUserExist > 0) {
        throw new BadRequestException('Email already exists');
      }

      const hashedPassword = await hashPassword(password);

      const affiliateUser = await this._prismaService.affiliateUser.create({
        data: {
          name,
          email,
          phoneNumber,
          password: hashedPassword,
          loginType: UserLoginType.CUSTOM,
        },
      });

      // Send verification email
      await this.verificationCode({ email: data.email });

      return affiliateUser;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async validateUser(data: {
    email: string;
    plainPassword: string;
  }): Promise<AffiliateUser> {
    const { email, plainPassword } = data;
    const User = await this._prismaService.affiliateUser.findUnique({
      where: { email },
    });

    if (!User) {
      throw new BadRequestException('User not found');
    }

    const isPasswordValid = await comparePasswords(
      plainPassword,
      User.password,
    ); // Compare the hashed password

    if (!isPasswordValid) {
      throw new BadRequestException('Invalid credentials');
    }

    return User;
  }

  async login(affiliateUser: AffiliateUser | any) {
    const payload = {
      userId: affiliateUser.id,
      email: affiliateUser.email,
      verified: affiliateUser.verified,
    };

    return {
      user: affiliateUser,
      userId: affiliateUser.id,
      verified: affiliateUser.verified,
      access_token: await this._jwtService.signAsync(payload),
    };
  }

  // Validate user credentials during login
  async validateAffiliateUser(data: {
    email: string;
    plainPassword: string;
  }): Promise<AffiliateUser> {
    const { email } = data;

    const affiliateUser = await this._prismaService.affiliateUser.findUnique({
      where: { email },
    });

    if (!affiliateUser) {
      throw new BadRequestException('User not found');
    }

    // Password validation would be done in the passport strategy
    return affiliateUser;
  }

  async getAffiliateUserInfo(userId: string) {
    try {
      return await this._prismaService.affiliateUser.findUnique({
        where: { id: userId },
      });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async verificationCode(data: VerificationRequestDto) {
    try {
      const user = await this._prismaService.affiliateUser.findUnique({
        where: { email: data.email },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // For affiliate users, we'll use the user ID as account ID for verification codes
      const { code } = await this._verificationCodeService.createCode(user.id);

      const payload = {
        email: user.email,
        name: user.name,
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
      const user = await this._prismaService.affiliateUser.findUnique({
        where: { email: data.email },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Use the correct field name and make it case-insensitive
      const isCodeVerified = await this._verificationCodeService.validateCode(
        user.id,
        data.verificationCode.toLowerCase(),
      );

      if (!isCodeVerified) {
        throw new BadRequestException('Invalid verification code');
      }

      await this._prismaService.affiliateUser.update({
        where: { id: user.id },
        data: { verified: true },
      });

      const payload = {
        userId: user.id,
        email: user.email,
        verified: true,
      };

      return {
        user: user,
        userId: user.id,
        verified: true,
        access_token: await this._jwtService.signAsync(payload),
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async setNewPassword(data: VerifyPasswordRequestDto) {
    try {
      const user = await this._prismaService.affiliateUser.findUnique({
        where: { email: data.email },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const isCodeVerified =
        await this._verificationCodeService.validateAffiliateUserCode(
          user.id,
          data.verificationCode,
        );

      if (!isCodeVerified) {
        throw new BadRequestException('Invalid verification code');
      }

      const hashedPassword = await hashPassword(data.newPassword);

      const updatedUser = await this._prismaService.affiliateUser.update({
        where: { id: user.id },
        data: { password: hashedPassword, verified: true },
      });

      const payload = {
        userId: user.id,
        email: user.email,
        verified: user.verified,
      };

      return {
        user: updatedUser,
        userId: user.id,
        access_token: await this._jwtService.signAsync(payload),
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async updateProfile(userId: string, data: UpdateProfileRequestDto) {
    try {
      const user = await this._prismaService.affiliateUser.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const updatedUser = await this._prismaService.affiliateUser.update({
        where: { id: userId },
        data: {
          name: data.name,
          phoneNumber: data.phoneNumber,
        },
      });

      return {
        success: true,
        user: updatedUser,
        message: 'Profile updated successfully',
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getAffiliateUserById(affiliateId: string) {
    try {
      const affiliate = await this._prismaService.affiliateUser.findUnique({
        where: { id: affiliateId },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          // Add any other fields needed for referral display
        },
      });

      if (!affiliate) {
        throw new BadRequestException('Affiliate user not found');
      }

      // For now, we'll return basic info and mock some stats
      // You can expand this to include real referral stats from your database
      return {
        success: true,
        affiliate: {
          ...affiliate,
          totalReferrals: 0, // Replace with actual count from user referrals
          activeReferrals: 0, // Replace with actual count
        },
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getReferredUsers(affiliateUserId: string) {
    try {
      // First verify the affiliate user exists
      const affiliateUser = await this._prismaService.affiliateUser.findUnique({
        where: { id: affiliateUserId },
      });

      if (!affiliateUser) {
        throw new BadRequestException('Affiliate user not found');
      }

      // Get all users referred by this affiliate using the UserReferral table
      const referralData = await this._prismaService.userReferral.findMany({
        where: {
          affiliateUserId: affiliateUserId,
        },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Transform the data to match frontend expectations
      const transformedUsers = referralData.map((referral) => ({
        id: referral.user.id,
        name: `${referral.user.firstName} ${referral.user.lastName}`.trim(),
        email: referral.user.email,
        emailVerified: referral.user.verified,
        signupDate: referral.user.createdAt,
        lastActivity: referral.user.updatedAt,
        status: referral.user.verified ? 'active' : 'pending',
        plan: 'Free', // Default plan
        repositoriesConnected: 0, // Can be expanded later
        organizationsCreated: 0, // Can be expanded later
        isActive: referral.isActive,
        referralDate: referral.registrationDate,
      }));

      return {
        success: true,
        data: transformedUsers,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getDashboardStats(affiliateUserId: string) {
    try {
      // First verify the affiliate user exists
      const affiliateUser = await this._prismaService.affiliateUser.findUnique({
        where: { id: affiliateUserId },
      });

      if (!affiliateUser) {
        throw new BadRequestException('Affiliate user not found');
      }

      // Get referred users count and stats
      const referredUsersCount = await this._prismaService.userReferral.count({
        where: { affiliateUserId: affiliateUserId },
      });

      const verifiedUsersCount = await this._prismaService.userReferral.count({
        where: {
          affiliateUserId: affiliateUserId,
          user: {
            verified: true,
          },
        },
      });

      const pendingUsersCount = referredUsersCount - verifiedUsersCount;

      // You can expand this to get real data from your tables
      const stats = {
        totalReferrals: referredUsersCount,
        activeUsers: verifiedUsersCount,
        pendingUsers: pendingUsersCount,
        verifiedUsers: verifiedUsersCount,
        totalRepositories: 0, // Get from repository connections
        totalOrganizations: 0, // Get from organization table
        totalEarnings: 0, // Get from earnings/commission table
        monthlyEarnings: 0, // Get from current month earnings
        currentPlan: 'Partner Pro',
        planStartDate: affiliateUser.createdAt,
        planPrice: '$29/month',
        nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      };

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getUserActivities(userId: string, affiliateUserId: string) {
    try {
      // First verify the affiliate user exists and owns this referral
      const referralRecord = await this._prismaService.userReferral.findFirst({
        where: {
          userId: userId,
          affiliateUserId: affiliateUserId,
        },
        include: {
          user: true,
        },
      });

      if (!referralRecord) {
        throw new BadRequestException('User not found or not referred by you');
      }

      // Mock activities for now - you can replace with real activity tracking
      const activities = [
        {
          type: 'signup',
          action: 'Signed up via referral',
          date: referralRecord.user.createdAt,
        },
      ];

      if (referralRecord.user.verified) {
        activities.push({
          type: 'verification',
          action: 'Email verified',
          date: referralRecord.user.updatedAt,
        });
      }

      return {
        success: true,
        data: activities,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
