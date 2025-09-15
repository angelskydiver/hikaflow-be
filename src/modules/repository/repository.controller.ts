import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/decorators/public';
import {
  CreateCustomFlagsRequestDto,
  GithubRepository,
  GithubRepositoryBranches,
  RegisterRepositoryRequestDto,
  UpdateRepositorySettingsPromptRequestDto,
} from './dto/repository.request.dto';
import { RepositoryService } from './repository.service';

@ApiTags('Repository')
@Controller('repository')
export class RepositoryController {
  constructor(private readonly _repositoryService: RepositoryService) {}

  @ApiBearerAuth()
  @Get('/github')
  GithubRepositories(@Query() params: GithubRepository, @Request() req: any) {
    return this._repositoryService.githubRepositories(
      params,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('/github/branches')
  GithubRepositoryBranches(
    @Query() params: GithubRepositoryBranches,
    @Request() req: any,
  ) {
    return this._repositoryService.githubRepositoryBranches(
      params,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Post('/register')
  RegisterRepository(
    @Request() req: any,
    @Body() data: RegisterRepositoryRequestDto,
  ) {
    return this._repositoryService.registerRepository(data, req.user.accountId);
  }

  @Public()
  @Get('/analyzeFiles')
  async AnalyzeFiles() {
    return await this._repositoryService.analyzeFiles();
  }

  @ApiBearerAuth()
  @Get('/accountRepositories')
  AccountRepositories(@Request() req: any) {
    return this._repositoryService.accountRepositories(req.user.accountId);
  }

  @ApiBearerAuth()
  @Get('/stats')
  DashboardStats(@Request() req: any) {
    return this._repositoryService.dashboardStats(req.user.accountId);
  }

  @ApiBearerAuth()
  @Get('/:repositoryId/stats')
  async RepositoryStats(
    @Request() req: any,
    @Param('repositoryId') repositoryId: string,
  ) {
    return await this._repositoryService.repositoryStats(
      repositoryId,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Get('/settings/:repositoryId')
  async FetchRepositorySettings(@Param('repositoryId') repositoryId: string) {
    const response =
      await this._repositoryService.fetchRepositorySettings(repositoryId);
    return response;
  }

  @Public()
  @Put('/updateRepositorySetting')
  async UpdateRepositorySettingsPrompt(
    @Body() data: UpdateRepositorySettingsPromptRequestDto,
  ) {
    return await this._repositoryService.updateRepositorySettingsPrompt(data);
  }

  @ApiBearerAuth()
  @Get('/:repositoryId/:orgId')
  async GetRepositoryById(
    @Request() req: any,
    @Param('repositoryId') repositoryId: string,
    @Param('orgId') orgId: string,
  ) {
    return await this._repositoryService.getRepositoryById(
      repositoryId,
      orgId,
      req.user.accountId,
    );
  }

  @ApiBearerAuth()
  @Put('/:repositoryId')
  async UpdateRepository(
    @Request() req: any,
    @Param('repositoryId') repositoryId: string,
    @Body() data: any,
  ) {
    return await this._repositoryService.updateRepository(
      repositoryId,
      req.user.accountId,
      data,
    );
  }

  @Public()
  @Post('/createRepositorySettings')
  async CreateRepositorySettings() {
    return await this._repositoryService.createRepositorySettings();
  }
  @Public()
  @Put('/updateRepositorySettings/:id')
  async UpdateRepositorySettings(
    @Param('id') id: string,
    @Body() customData: any = null,
  ) {
    return await this._repositoryService.updateRepositorySettings(
      id,
      customData,
    );
  }

  //
  @Public()
  @Get('/bitbucket-branches')
  async BitbucketRepositorySlug(@Query() data: { repoSlug: string }) {
    console.log('hllo');
    return await this._repositoryService.bitbucketRepositoryBranches(
      data.repoSlug,
    );
  }

  @Public()
  @Post('/createRepositorySetting/:repositoryId')
  async CreateRepositorySetting(
    @Param('repositoryId') repositoryId: string,
    @Body() data: CreateCustomFlagsRequestDto[],
  ) {
    return await this._repositoryService.createRepositorySetting(
      repositoryId,
      data,
    );
  }

  @ApiBearerAuth()
  @Put('/settings/:settingId/customPrompt')
  async updateRepositorySettingsCustomPrompt(
    @Param('settingId') settingId: string,
    @Body() data: { customPrompt: string },
    @Request() req: any,
  ) {
    return await this._repositoryService.updateRepositorySettingsCustomPrompt(
      settingId,
      data.customPrompt,
    );
  }
}
