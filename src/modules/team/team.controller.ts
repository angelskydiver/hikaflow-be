import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  AddTeamMemberDto,
  ChangeTeamMemberRoleDto,
  CreateTeamDto,
  CreateTeamRoleDto,
  DefineOrganizationHierarchyDto,
  LinkTeamRepositoryDto,
} from './team.dtos';
import { TeamService } from './team.service';

@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  async createTeam(@Body() dto: CreateTeamDto) {
    return await this.teamService.createTeam(dto);
  }

  @Post(':teamId/roles')
  async createRole(
    @Param('teamId') teamId: string,
    @Body() dto: CreateTeamRoleDto,
  ) {
    return await this.teamService.createRole({ teamId, ...dto });
  }

  @Post(':teamId/members')
  async addMember(
    @Param('teamId') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return await this.teamService.addMember({ teamId, ...dto });
  }

  @Patch(':teamId/members/:accountId')
  async changeMemberRole(
    @Param('teamId') teamId: string,
    @Param('accountId') accountId: string,
    @Body() dto: ChangeTeamMemberRoleDto,
  ) {
    return await this.teamService.changeMemberRole({
      teamId,
      accountId,
      ...dto,
    });
  }

  @Post(':teamId/repositories')
  async linkRepository(
    @Param('teamId') teamId: string,
    @Body() dto: LinkTeamRepositoryDto,
  ) {
    return await this.teamService.linkRepository({ teamId, ...dto });
  }

  @Post('/organization/:organizationId/hierarchy')
  async defineHierarchy(
    @Param('organizationId') organizationId: string,
    @Body() dto: DefineOrganizationHierarchyDto,
  ) {
    return await this.teamService.defineOrganizationHierarchy({
      organizationId,
      ...dto,
    });
  }

  @Get('/by-organization/:organizationId')
  async listByOrganization(@Param('organizationId') organizationId: string) {
    return await this.teamService.listByOrganization(organizationId);
  }

  @Get('/by-repository/:repositoryId')
  async listByRepository(@Param('repositoryId') repositoryId: string) {
    return await this.teamService.listByRepository(repositoryId);
  }

  @Delete(':teamId/repositories/:repositoryId')
  async unlinkRepository(
    @Param('teamId') teamId: string,
    @Param('repositoryId') repositoryId: string,
    @Body() dto: Pick<LinkTeamRepositoryDto, 'requestedByAccountId'>,
  ) {
    return await this.teamService.unlinkRepository({
      teamId,
      repositoryId,
      ...dto,
    });
  }

  @Delete(':teamId/members/:accountId')
  async removeMember(
    @Param('teamId') teamId: string,
    @Param('accountId') accountId: string,
    @Body() dto: Pick<LinkTeamRepositoryDto, 'requestedByAccountId'>,
  ) {
    return await this.teamService.removeMember({
      teamId,
      accountId,
      requestedByAccountId: dto.requestedByAccountId,
    });
  }
}
