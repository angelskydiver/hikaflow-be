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
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async updateAccount(id: string, data: any) {
    try {
      const Account = await this._prismaService.account.findFirst({
        where: { id },
      });
      if (!Account) throw new BadRequestException('Account not found');
      return this._prismaService.account.update({ where: { id }, data });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
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
      console.log(error.message);
      throw new BadRequestException(error.message);
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

      // Check if name already exists for this account (case-insensitive check)
      const allNames = await this._prismaService.gitContributorName.findMany({
        where: { accountId },
        select: { name: true },
      });
      const existing = allNames.some(
        (n) => n.name.toLowerCase() === trimmedName.toLowerCase(),
      );

      if (existing) {
        throw new BadRequestException('This Git contributor name already exists');
      }

      return await this._prismaService.gitContributorName.create({
        data: {
          accountId,
          name: trimmedName,
        },
      });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async deleteGitContributorName(id: string, accountId: string) {
    try {
      const gitName = await this._prismaService.gitContributorName.findFirst({
        where: { id, accountId },
      });

      if (!gitName) {
        throw new BadRequestException('Git contributor name not found');
      }

      return await this._prismaService.gitContributorName.delete({
        where: { id },
      });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
