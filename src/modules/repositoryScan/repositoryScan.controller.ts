import { Controller, Get, Param, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { RepositoryScanService } from './repositoryScan.service';

@Controller('repositoryScan')
export class RepositoryScanController {
  constructor(private _repositoryScanService: RepositoryScanService) {}

  @Post('/:repositoryId')
  @ApiBearerAuth()
  async QueueRepositoryScan(
    @Param('repositoryId') id: string,
    @Request() req: any,
  ) {
    try {
      return await this._repositoryScanService.queueRepositoryScan(
        id,
        req.user.accountId,
      );
    } catch (error) {
      console.error(error);
    }
  }

  @Get('structure/:repositoryId')
  @ApiBearerAuth()
  async FetchFileStructure(
    @Param('repositoryId') repositoryId: string,
    @Request() req: any,
  ) {
    try {
      return await this._repositoryScanService.fetchFileStructure(
        repositoryId,
        req.user.accountId,
      );
    } catch (error) {
      console.error(error);
    }
  }

  @Get('fileContent')
  @ApiBearerAuth()
  async FetchFileSummary(@Query() data: any, @Request() req: any) {
    try {
      return await this._repositoryScanService.fetchFileSummary({
        repositoryId: data.scanId,
        path: data.path,
      });
    } catch (error) {
      console.error(error);
    }
  }

  @Get('scanStatus/:repositoryId')
  async FetchScanStatus(@Param('repositoryId') repositoryId: string) {
    try {
      return await this._repositoryScanService.fetchScanStatus(repositoryId);
    } catch (error) {
      console.error(error);
    }
  }
}
