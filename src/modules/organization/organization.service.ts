import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import {
  CreateOrganizationRequestDto,
  InviteUserToOrganizationRequestDTO,
} from './dto/organization.request.dto';

@Injectable()
export class OrganizationService {
  constructor(
    private _prismaService: PrismaService,
    private _mailService: MailService,
    private _billingService: BillingService,
  ) {}

  async createOrganization(
    data: CreateOrganizationRequestDto,
    accountId: string,
  ) {
    try {
      const { organizationExist } = await this.organizationExist(accountId);
      if (organizationExist) {
        throw new BadRequestException('Organization already exists');
      }

      let createdOrganization;

      await this._prismaService.$transaction(async () => {
        // Create the organization
        createdOrganization = await this._prismaService.organization.create({
          data: data,
        });

        // Create the organization-account relationship
        await this._prismaService.organizationAccounts.create({
          data: {
            accountId: accountId,
            organizationId: createdOrganization.id,
            role: 'ADMIN',
          },
        });
      });

      // Create a 15-day trial subscription for the new organization
      if (createdOrganization) {
        try {
          await this._billingService.createTrialSubscription(
            createdOrganization.id,
          );
        } catch (subError) {
          console.error('Error creating trial subscription:', subError);
          // Don't throw error here - organization was created successfully
        }
      }

      return {
        Success: true,
        organizationId: createdOrganization?.id,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async inviteUserToOrganization(
    data: InviteUserToOrganizationRequestDTO,
    accountId: string,
  ) {
    try {
      const organization = await this._prismaService.organization.findUnique({
        where: { id: data.organizationId },
      });
      if (!organization) throw new NotFoundException('Organization not found');

      const account = await this._prismaService.account.findUnique({
        where: { id: accountId },
        include: { user: true },
      });
      if (!account) throw new NotFoundException('Account not found');

      const invitationPayloads = data.users.map((user) => {
        const payload = {
          organizationId: data.organizationId,
          role: user.role,
          email: user.email,
          name: user.name,
          inviterId: account.user.id,
        };

        return this._prismaService.organizationInvitation.create({
          data: payload,
        });
      });

      try {
        await Promise.all(invitationPayloads);
      } catch (error) {
        console.log(error);
      }

      // send email with invitation link
      const sendEmailMapping = data.users.map((user) => {
        const payload = {
          organizationId: data.organizationId,
          role: user.role,
          email: user.email,
          name: user.name,
        };

        return this._mailService.organizationInvitation({
          email: payload.email,
          userName: payload.name,
          organizationName: organization.name,
          inviterName:
            account.user.firstName +
            (account.user.lastName ? ' ' + account.user.lastName : ''),
          signupLink: `${process.env.HIKAFLOW_PORTAL_URL}/organization/invitation/${organization.id}`,
          role: payload.role,
        });
      });

      await Promise.all(sendEmailMapping);
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async getOrganizationInvitations(organizationId: string, accountId: string) {
    try {
      const isValidAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            organizationId: organizationId,
            accountId: accountId,
          },
        });
      if (!isValidAccount) throw new NotFoundException('Invalid account');
      const invitations =
        await this._prismaService.organizationInvitation.findMany({
          where: {
            organizationId: organizationId,
          },
          include: {
            organization: true,
            inviter: true,
          },
        });
      return invitations;
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

  async organizationExist(accountId: string) {
    try {
      const organization =
        await this._prismaService.organizationAccounts.findFirst({
          where: { accountId: accountId },
        });
      if (organization) {
        return {
          organizationExist: true,
          organizationId: organization.organizationId,
          isAdmin:
            organization.role === 'ADMIN' || organization.role === 'MANAGER',
          role: organization.role,
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
      const organizationAccount =
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

      const accountUser = await this._prismaService.account.findFirst({
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
      const account = await this._prismaService.account.findUnique({
        where: { id: accountId },
        include: { user: true },
      });

      if (!account) {
        throw new NotFoundException('Account not found');
      }

      const organizationAccount =
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

      const memberAccount =
        await this._prismaService.organizationAccounts.findFirst({
          where: {
            accountId: accountId,
            organizationId: organizationId,
          },
        });

      if (memberAccount) {
        throw new BadRequestException(
          'You are already a member of this organization',
        );
      }

      const invitation =
        await this._prismaService.organizationInvitation.findFirst({
          where: {
            organizationId: organizationId,
            email: account.user.email,
          },
        });

      if (!invitation) {
        throw new NotFoundException(
          'Invitation not found ask your administrator to resend the invitation',
        );
      }

      await this._prismaService.organizationAccounts.create({
        data: {
          accountId: accountId,
          organizationId: organizationId,
          role: invitation.role,
        },
      });

      await this._prismaService.organizationInvitation.update({
        where: {
          id: invitation.id,
        },
        data: { status: 'accepted' },
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
