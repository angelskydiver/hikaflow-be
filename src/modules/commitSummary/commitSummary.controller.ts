import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from 'src/decorators/public';
import { CommitSummaryService } from './commitSummary.service';

@Controller('commit-summary')
export class CommitSummaryController {
  constructor(private readonly commitSummaryService: CommitSummaryService) {}

  /**
   * POST /commit-summary/embed-active-repositories
   * Generate embeddings for the last 15 commit summaries of active repositories with active subscriptions
   */
  @Public()
  @Post('embed-active-repositories')
  @HttpCode(HttpStatus.OK)
  async embedActiveRepositoriesCommits() {
    try {
      const result =
        await this.commitSummaryService.embedActiveRepositoriesCommits();
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * POST /commit-summary/generate-all-embeddings
   * Generate embeddings for all commit summaries without embeddings (optional repositoryId)
   */
  @Public()
  @Post('generate-all-embeddings')
  async generateAllCommitEmbeddings() {
    try {
      const result =
        await this.commitSummaryService.generateAllCommitEmbeddings();
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
