import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Public } from 'src/decorators/public';
import { hikaflowQuestionnaireRequestDto } from './dto/repositoryScan.request.dto';
import { RepositoryScanService } from './repositoryScan.service';

@Controller('repositoryScan')
export class RepositoryScanController {
  constructor(private _repositoryScanService: RepositoryScanService) {}

  @Public()
  @Post('/hikaflowQuestionnaire')
  async hikaflowQuestionnaire(@Body() body: hikaflowQuestionnaireRequestDto) {
    try {
      return await this._repositoryScanService.hikaflowQuestionnaire(body);
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }

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

  @Public()
  @Get('testRoute/:scanId')
  async EmbedRepositoryById(@Param('scanId') scanId: string) {
    try {
      console.log('scanId', scanId);
      return await this._repositoryScanService.embedRepositoryById(scanId);
    } catch (error) {
      console.error(error);
    }
  }

  // @Public()
  @ApiBearerAuth()
  @Post('askQuestion/:repositoryId')
  async TestAnalyzeAssistance(
    @Param('repositoryId') repositoryId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    try {
      return await this._repositoryScanService.testAnalyzeAssistance(
        repositoryId,
        body.query,
        req.user.accountId,
      );
    } catch (error) {
      console.error(error);
    }
  }

  @ApiBearerAuth()
  @Get('/savedQuestions/:repositoryId')
  async FetchedSavedQuestions(@Param('repositoryId') repositoryId: string) {
    try {
      return await this._repositoryScanService.fetchedSavedQuestions(
        repositoryId,
      );
    } catch (error) {
      console.log(error.message);
    }
  }

  @ApiBearerAuth()
  @Put('/savedQuestions/:questionId')
  async MarkQuestionSaved(@Param('questionId') questionId: string) {
    try {
      return await this._repositoryScanService.markQuestionSaved(questionId);
    } catch (error) {
      console.log(error);
      throw new BadRequestException(error.message);
    }
  }
}
