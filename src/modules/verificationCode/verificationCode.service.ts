import { BadRequestException, Injectable } from '@nestjs/common';
import * as otpGenerator from 'otp-generator'; // Import the otp-generator package
import { getExpiryTime } from 'src/config/helpers/moment.helper';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class VerificationCodeService {
  constructor(private _prismaService: PrismaService) {}

  async createCode(accountId: string): Promise<{ code: string }> {
    const code = this._generateRandomCode(); // Generate the 4-digit code
    const expiresAt = getExpiryTime(10);

    try {
      // Save the verification code and expiry time to the database
      await this._prismaService.verificationCode.create({
        data: {
          accountId: accountId,
          code: code, // Store the generated code
          expiresAt: expiresAt, // Store the expiry time
        },
      });

      return { code }; // Optionally, return the code and expiry time as part of the response
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message); // Handle errors by throwing a BadRequestException
    }
  }

  async validateCode(accountId: string, inputCode: string) {
    try {
      // Retrieve the verification code from the database
      const verificationCodes =
        await this._prismaService.verificationCode.findMany({
          where: { accountId: accountId },
        });

      let verificationCode = verificationCodes[verificationCodes.length - 1];

      // If no code exists for this account, throw an error
      if (!verificationCode) {
        throw new BadRequestException(
          'Verification code does not exist for this account.',
        );
      }

      // Check if the code has expired
      const currentTime = new Date();
      if (verificationCode.expiresAt < currentTime) {
        throw new BadRequestException('Verification code has expired.');
      }

      // Check if the input code matches the stored code
      if (verificationCode.code !== inputCode) {
        throw new BadRequestException('Invalid verification code.');
      }

      return { success: true };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message); // Handle errors by throwing a BadRequestException
    }
  }

  // Generate a random 4-digit OTP code
  private _generateRandomCode(): string {
    return otpGenerator.generate(4, {
      upperCase: false,
      specialChars: false,
      digits: true,
    }); // Generate a 4-digit code (without uppercase and special chars)
  }
}
