import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public';
import {
  CreateOrganizationRequestDto,
  InviteUserToOrganizationRequestDTO,
} from './dto/organization.request.dto';
import { OrganizationService } from './organization.service';

@ApiTags('Organization')
@Controller('organization')
export class OrganizationController {
  constructor(private _organizationService: OrganizationService) {}

  @ApiBearerAuth()
  @Post('create')
  async createOrganization(
    @Body() data: CreateOrganizationRequestDto,
    @Request() req: any,
  ) {
    return await this._organizationService.createOrganization(
      data,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('isExist')
  async OrganizationExist(@Request() req: any) {
    return await this._organizationService.organizationExist(
      req.user.accountId,
    );
  }

  @Public()
  @Get('info/:id')
  async OrganizationInfo(@Param('id') id: string) {
    return await this._organizationService.organizationInfo(id);
  }

  @ApiBearerAuth()
  @Post('accept/invitation/:id')
  async AcceptInvitation(@Param('id') id: string, @Request() req: any) {
    return await this._organizationService.acceptInvitation(
      id,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('/invitations/:orgId')
  async GetOrganizationInvitations(
    @Param('orgId') orgId: string,
    @Request() req: any,
  ) {
    return await this._organizationService.getOrganizationInvitations(
      orgId,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Post('invite/user')
  async InviteUserToOrganization(
    @Body() data: InviteUserToOrganizationRequestDTO,
    @Request() req: any,
  ) {
    return await this._organizationService.inviteUserToOrganization(
      data,
      req.user.accountId,
    );
  }
}
