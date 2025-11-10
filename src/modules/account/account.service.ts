import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAccountRequestDto } from './dto/account.request.dto';

@Injectable()
export class AccountService {
  constructor(private readonly _prismaService: PrismaService) {}

  async createAccount(data: CreateAccountRequestDto) {
    try {
      return await this._prismaService.account.create({ data });
    } catch (error) {
      console.error('Error creating account:', error);
      throw new BadRequestException(
        error.message || 'Failed to create account',
      );
    }
  }

  async updateAccount(id: string, data: any) {
    try {
      return await this._prismaService.account.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new BadRequestException('Account not found');
      }
      console.error(error.message);
      throw new BadRequestException(
        error.message || 'Failed to update account',
      );
    }
  }

  async getGitContributorNames(accountId: string) {
    try {
      const account = await this._prismaService.account.findUnique({
        where: { id: accountId },
      });
      if (!account) throw new BadRequestException('Account not found');

      return await this._prismaService.gitContributorName.findMany({
        where: { accountId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      console.error('Error getting Git contributor names:', error);
      throw new BadRequestException(
        error.message || 'Failed to get Git contributor names',
      );
    }
  }

  async addGitContributorName(accountId: string, name: string) {
    try {
      const account = await this._prismaService.account.findUnique({
        where: { id: accountId },
      });
      if (!account) throw new BadRequestException('Account not found');

      const trimmedName = name.trim();
      if (!trimmedName || trimmedName.length < 2) {
        throw new BadRequestException('Git contributor name must be at least 2 characters');
      }
      // Allow spaces and any reasonable characters (Git committer names can have spaces)

      // Use database-level unique constraint to prevent race conditions
      // The unique constraint on [accountId, name] will handle duplicates
      try {
        return await this._prismaService.gitContributorName.create({
          data: {
            accountId,
            name: trimmedName,
          },
        });
      } catch (createError) {
        if (createError.code === 'P2002') {
          // Unique constraint violation - name already exists
          throw new BadRequestException('This Git contributor name already exists');
        }
        throw createError;
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error(error.message);
      throw new BadRequestException(
        error.message || 'Failed to add Git contributor name',
      );
    }
  }

  async deleteGitContributorName(id: string, accountId: string) {
    try {
      // Use combined where clause to ensure accountId matches and handle race conditions
      return await this._prismaService.gitContributorName.delete({
        where: { id, accountId },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new BadRequestException('Git contributor name not found');
      }
      console.error(error.message);
      throw new BadRequestException(
        error.message || 'Failed to delete Git contributor name',
      );
    }
  }
}
