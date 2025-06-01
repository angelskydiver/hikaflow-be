import { BadRequestException, Injectable } from '@nestjs/common';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import { parseGitDiffByFile } from 'src/config/helpers/repositories/bitbucket.helper';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CommitSummaryService {
  constructor(private readonly _prismaService: PrismaService) {}

  async createCommitSummary(data, repositoryId: string, reportId: string) {
    try {
      const deepSeek = new DeepSeek();

      let filesPatch = {};
      if (!data.files[0].filename) {
        filesPatch = parseGitDiffByFile(data.files, data.patch);
      }

      // TODO need to do proper testing with github
      const summary = await deepSeek.analyzeCommitSummary(
        data.files.map((file) => {
          if (file.filename)
            return { fileName: file.filename, patch: file.patch };

          return { fileName: file, patch: filesPatch[file] };
        }),
      );
      const payload = {
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
      const commitSummary = await this._prismaService.commitSummary.create({
        data: { ...payload },
      });

      console.log('commitSummary:: ', commitSummary);

      // Generate and store embedding for semantic search
      await this.generateCommitEmbedding(commitSummary.id);

      return 1;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Generate embedding for a commit summary
   */
  async generateCommitEmbedding(commitSummaryId: string) {
    try {
      const commitSummary = await this._prismaService.commitSummary.findUnique({
        where: { id: commitSummaryId },
      });

      if (!commitSummary) {
        throw new Error('Commit summary not found');
      }

      // Create text for embedding from commit message and summary
      const embedText = `${commitSummary.commitMessage} ${
        typeof commitSummary.summary === 'object'
          ? JSON.stringify(commitSummary.summary)
          : commitSummary.summary
      }`;

      const gemini = new Gemini();
      const embedding = await gemini.getEmbeddings(embedText);

      // Store embedding using raw SQL
      await this._prismaService.$executeRaw`
        UPDATE "commitSummary"
        SET "commitSummaryEmbedding" = ${embedding}::vector
        WHERE id = ${commitSummaryId}
      `;

      console.log(`Generated embedding for commit ${commitSummary.commitId}`);
    } catch (error) {
      console.error('Error generating commit embedding:', error);
      // Don't throw error to avoid breaking the commit creation process
    }
  }

  /**
   * Generate embeddings for all existing commits without embeddings
   */
  async generateAllCommitEmbeddings(repositoryId?: string) {
    try {
      let commitsWithoutEmbeddings: any[];

      if (repositoryId) {
        // Query for specific repository using raw SQL
        commitsWithoutEmbeddings = (await this._prismaService.$queryRaw`
          SELECT 
            id, 
            "commitId",
            committer,
            additions,
            deletions,
            "totalFiles",
            "repositoryId",
            "reportId",
            "commitMessage",
            summary,
            "createdAt",
            "commitSummaryEmbedding"::text as "commitSummaryEmbedding"
          FROM "commitSummary" 
          WHERE "repositoryId" = ${repositoryId}
          AND "commitSummaryEmbedding" IS NULL
          ORDER BY "createdAt" DESC
          LIMIT 50
        `) as any[];
      } else {
        // Query for all repositories using raw SQL
        commitsWithoutEmbeddings = (await this._prismaService.$queryRaw`
          SELECT 
            id, 
            "commitId",
            committer,
            additions,
            deletions,
            "totalFiles",
            "repositoryId",
            "reportId",
            "commitMessage",
            summary,
            "createdAt",
            "commitSummaryEmbedding"::text as "commitSummaryEmbedding"
          FROM "commitSummary" 
          WHERE "commitSummaryEmbedding" IS NULL
          ORDER BY "createdAt" DESC
          LIMIT 50
        `) as any[];
      }

      console.log(
        `Processing ${commitsWithoutEmbeddings.length} commits for embedding generation`,
      );

      for (const commit of commitsWithoutEmbeddings) {
        await this.generateCommitEmbedding(commit.id);
        // Add small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      return {
        processed: commitsWithoutEmbeddings.length,
        message: 'Embedding generation completed',
      };
    } catch (error) {
      console.error('Error in batch embedding generation:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Search commits using semantic similarity
   */
  async searchCommitsBySemantic(
    query: string,
    repositoryId: string,
    limit: number = 10,
  ) {
    try {
      const gemini = new Gemini();
      const embedding = await gemini.getEmbeddings(query);
      const vectorQuery = `[${embedding.join(',')}]`;

      const results = await this._prismaService.$queryRaw`
        SELECT 
          id, 
          "commitId", 
          "commitMessage", 
          committer, 
          summary, 
          "createdAt", 
          additions, 
          deletions, 
          "totalFiles",
          ("commitSummaryEmbedding"::text)::vector <=> ${vectorQuery}::vector as similarity
        FROM "commitSummary" 
        WHERE "repositoryId" = ${repositoryId}
        AND "commitSummaryEmbedding" IS NOT NULL
        ORDER BY similarity
        LIMIT ${limit}
      `;

      return results;
    } catch (error) {
      console.error('Error in semantic commit search:', error);
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Generate embeddings for last 15 commit summaries of active repositories with active subscriptions
   */
  async embedActiveRepositoriesCommits() {
    try {
      console.log('Starting embedding process for active repositories...');

      // Find active repositories with active subscriptions
      const activeRepositories = await this._prismaService.repository.findMany({
        where: {
          organization: {
            subscriptions: {
              some: {
                isActive: true,
              },
            },
          },
        },
        include: {
          organization: {
            include: {
              subscriptions: {
                where: {
                  isActive: true,
                },
              },
            },
          },
        },
      });

      console.log(
        `Found ${activeRepositories.length} active repositories with active subscriptions`,
      );

      let totalProcessed = 0;
      let totalEmbedded = 0;

      for (const repository of activeRepositories) {
        try {
          console.log(`Processing repository: ${repository.name}`);

          // Get last 15 commit summaries without embeddings using raw query
          const commitSummaries = (await this._prismaService.$queryRaw`
            SELECT 
              id, 
              "commitId",
              committer,
              additions,
              deletions,
              "totalFiles",
              "repositoryId",
              "reportId",
              "commitMessage",
              summary,
              "createdAt",
              "commitSummaryEmbedding"::text as "commitSummaryEmbedding"
            FROM "commitSummary" 
            WHERE "repositoryId" = ${repository.id}
            AND "commitSummaryEmbedding" IS NULL
            ORDER BY "createdAt" DESC
            LIMIT 15
          `) as any[];

          console.log(
            `Found ${commitSummaries.length} commit summaries to embed for ${repository.name}`,
          );

          // Generate embeddings for each commit summary
          for (const commitSummary of commitSummaries) {
            try {
              await this.generateCommitEmbedding(commitSummary.id);
              totalEmbedded++;

              // Add small delay to avoid rate limiting
              await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (embeddingError) {
              console.error(
                `Error embedding commit ${commitSummary.id}:`,
                embeddingError,
              );
            }
          }

          totalProcessed += commitSummaries.length;
        } catch (repoError) {
          console.error(
            `Error processing repository ${repository.name}:`,
            repoError,
          );
        }
      }

      const result = {
        repositoriesProcessed: activeRepositories.length,
        totalCommitsProcessed: totalProcessed,
        totalCommitsEmbedded: totalEmbedded,
        message: 'Embedding process completed for active repositories',
      };

      console.log('Embedding process completed:', result);
      return result;
    } catch (error) {
      console.error('Error in embedActiveRepositoriesCommits:', error);
      throw new BadRequestException(
        `Failed to embed active repositories commits: ${error.message}`,
      );
    }
  }
}
