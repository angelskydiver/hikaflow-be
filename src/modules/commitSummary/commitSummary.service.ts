import { BadRequestException, Injectable } from '@nestjs/common';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CommitSummaryService {
  constructor(private readonly _prismaService: PrismaService) {}

  async createCommitSummary(data, repositoryId: string, reportId: string) {
    try {
      let deepSeek = new DeepSeek();

      let summary = await deepSeek.analyzeCommitSummary(
        data.files.map((file) => ({
          fileName: file.filename,
          patch: file.patch,
        })),
      );
      let payload = {
        commitId: data.sha,
        committer: data.author.login,
        additions: data.stats.additions,
        deletions: data.stats.deletions,
        totalFiles: data.files.length,
        repositoryId: repositoryId,
        reportId: reportId,
        commitMessage: data.commit.message,
        summary: summary,
      };
      console.log(data);
      let commitSummary = await this._prismaService.commitSummary.create({
        //   @ts-ignore
        data: { ...payload },
      });

      console.log('commitSummary:: ', commitSummary);
      return 1;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
