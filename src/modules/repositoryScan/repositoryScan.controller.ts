import { Controller, Param, Post, Request } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { RepositoryScanService } from './repositoryScan.service';

@Controller('repositoryScan')
export class RepositoryScanController {
  constructor(private _repositoryScanService: RepositoryScanService) {}

  @Post('/:repositoryName')
  @ApiBearerAuth()
  async ScanRepositories(
    @Param('repositoryName') name: string,
    @Request() req: any,
  ) {
    try {
      return await this._repositoryScanService.scanRepositories(
        name,
        req.user.accountId,
      );
    } catch (error) {
      console.error(error);
    }
  }
}
