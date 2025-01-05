import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateOrganizationRequestDto } from './dto/organization.request.dto';

@Injectable()
export class OrganizationService {
  constructor(private _prismaService: PrismaService) {}

  async createOrganization(
    data: CreateOrganizationRequestDto,
    accountId: string,
  ) {
    try {
      await this._prismaService.$transaction(async () => {
        let organization = await this._prismaService.organization.create({
          data: data,
        });

        await this._prismaService.organizationAccounts.create({
          data: {
            accountId: accountId,
            organizationId: organization.id,
            role: 'ADMIN',
          },
        });
      });

      return {
        Success: true,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async inviteUserToOrganization(accountId: string, organizationId: string) {
    try {
      let organization = await this._prismaService.organization.findUnique({
        where: { id: organizationId },
      });
      if (!organization) throw new NotFoundException('Organization not found');

      let account = await this._prismaService.account.findUnique({
        where: { id: accountId },
      });
      if (!account) throw new NotFoundException('Account not found');

      await this._prismaService.organizationAccounts.create({
        data: {
          accountId: accountId,
          organizationId: organizationId,
          role: 'MEMBER',
        },
      });
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async organizationExist(accountId: string) {
    try {
      let organization =
        await this._prismaService.organizationAccounts.findFirst({
          where: { accountId: accountId },
        });
      if (organization) {
        return {
          organizationExist: true,
          organizationId: organization.organizationId,
          isAdmin: organization.role === 'ADMIN',
        };
      } else {
        return { organizationExist: false };
      }
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async organizationInfo(organizationId: string) {
    try {
      let organizationAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            role: 'ADMIN',
            organizationId: organizationId,
          },
          include: {
            account: true,
            organization: true,
          },
        });

      let accountUser = await this._prismaService.account.findFirst({
        where: {
          id: organizationAccount.accountId,
        },
        include: {
          user: true,
        },
      });

      return { ...organizationAccount, user: accountUser.user };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async acceptInvitation(organizationId: string, accountId: string) {
    try {
      let account = await this._prismaService.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new NotFoundException('Account not found');
      }

      let organizationAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            role: 'ADMIN',
            organizationId: organizationId,
          },
        });

      if (!organizationAccount) {
        throw new NotFoundException(
          'No admin account found for the organization',
        );
      }

      if (organizationAccount.accountId == accountId) {
        throw new BadRequestException('You are already an admin');
      }

      await this._prismaService.organizationAccounts.create({
        data: {
          accountId: accountId,
          organizationId: organizationId,
          role: 'MEMBER',
        },
      });
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
