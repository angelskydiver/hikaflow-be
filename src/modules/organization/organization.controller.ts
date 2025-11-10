import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UnauthorizedException,
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
    if (!req.user) {
      throw new UnauthorizedException('User not authenticated');
    }
    return await this._organizationService.createOrganization(
      data,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('isExist')
  async organizationExist(@Request() req: any) {
    return await this._organizationService.organizationExist(
      req.user.accountId,
    );
  }

  @Public()
  @Get('info/:id')
  // TODO: Add rate limiting to this public endpoint using @nestjs/throttler
  // Example: @Throttle(10, 60) // 10 requests per 60 seconds
  async organizationInfo(@Param('id') id: string) {
    return await this._organizationService.organizationInfo(id);
  }

  @ApiBearerAuth()
  @Post('accept/invitation/:id')
  async acceptInvitation(@Param('id') id: string, @Request() req: any) {
    return await this._organizationService.acceptInvitation(
      id,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('/invitations/:orgId')
  async getOrganizationInvitations(
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
  async inviteUserToOrganization(
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
