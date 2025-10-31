import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public';
import {
  CreateOrganizationRequestDto,
  InviteUserToOrganizationRequestDTO,
  OrganizationInsightsQueryDto,
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
  @Get('members/:orgId')
  async getOrganizationMembers(
    @Param('orgId') orgId: string,
    @Request() req: any,
  ) {
    return await this._organizationService.getOrganizationMembers(
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

  @ApiBearerAuth()
  @Get('insights/:organizationId')
  @ApiQuery({ name: 'repositoryId', required: false })
  @ApiQuery({ name: 'daysLimit', required: false, type: Number })
  @ApiQuery({ name: 'prLimit', required: false, type: Number })
  async getOrganizationInsights(
    @Param('organizationId') organizationId: string,
    @Query() query: OrganizationInsightsQueryDto,
    @Request() req: any,
  ) {
    return await this._organizationService.getOrganizationInsights(
      organizationId,
      query,
      req.user.accountId,
    );
  }
}
