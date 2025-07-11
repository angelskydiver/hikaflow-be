import { BadRequestException, Injectable } from '@nestjs/common';
import { DeepSeek } from 'src/config/helpers/ai/deepseek.ai.helper';
import { Gemini } from 'src/config/helpers/ai/gemini.ai.helper';
import {
  commitInfoBitbucket,
  parseGitDiffByFile,
} from 'src/config/helpers/repositories/bitbucket.helper';
import { commitInfo } from 'src/config/helpers/repositories/github.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountCredentialService } from '../accountCredentials/accountCredentials.service';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class CommitSummaryService {
  constructor(
    private readonly _prismaService: PrismaService,
    private readonly _billingService: BillingService,
    private readonly accountCredentialsService: AccountCredentialService, // Replace with actual service type
  ) {}

  // Enhanced method with comprehensive AI analysis
  async createCommitSummary(data, repositoryId: string, reportId?: string) {
    try {
      console.log(
        `Starting detailed commit analysis for commit ${data.sha || data.id}`,
      );
      const startTime = Date.now();

      const deepSeek = new DeepSeek();

      // **DATA STRUCTURE DETECTION AND NORMALIZATION**
      const isWebhookData =
        !data.files && (data.added || data.modified || data.removed);

      let isCommitExist = await this._prismaService.commitSummary.findFirst({
        where: {
          repositoryId: repositoryId,
          commitId: data.sha || data.id,
        },
      });

      console.log('isCommitExist: ', isCommitExist);
      if (isCommitExist) {
        console.log('Commit already exists, skipping');
        return null;
      }
      let normalizedData;
      if (isWebhookData) {
        // Get actual diff stats from API instead of just counting files
        let actualStats = {
          additions: (data.added || []).length,
          deletions: (data.removed || []).length,
        };

        // Try to fetch actual line additions/deletions from commit diff
        try {
          const repository = await this._prismaService.repository.findFirst({
            where: { repositoryId },
            include: {
              organization: true,
            },
          });

          if (repository) {
            const organizationAccount =
              await this._prismaService.organizationAccounts.findFirst({
                where: {
                  organizationId: repository.organizationId,
                  role: 'ADMIN',
                },
              });

            if (organizationAccount) {
              const { decryptedToken } =
                await this.accountCredentialsService.getAccountToken({
                  accountId: organizationAccount.accountId,
                });

              if (decryptedToken) {
                const platform =
                  repository.provider === 'BITBUCKET' ? 'bitbucket' : 'github';

                if (platform === 'github') {
                  // Fetch actual commit stats from GitHub API
                  const commitDiffData = await commitInfo({
                    owner: repository.owner,
                    repo: repository.name,
                    commitSha: data.id,
                    token: `  ${decryptedToken}`,
                  });

                  if (commitDiffData && commitDiffData.stats) {
                    actualStats = {
                      additions: commitDiffData.stats.additions || 0,
                      deletions: commitDiffData.stats.deletions || 0,
                    };
                    console.log(
                      'Retrieved actual diff stats from GitHub:',
                      actualStats,
                    );
                  }
                } else if (platform === 'bitbucket') {
                  // For Bitbucket, we can also get stats from diff API
                  try {
                    const diffUrl = `https://api.bitbucket.org/2.0/repositories/${repository.owner}/${repository.name}/diff/${data.id}`;
                    const commitDiffData = await commitInfoBitbucket({
                      token: decryptedToken,
                      commitDiffUrl: diffUrl,
                    });

                    // Parse Bitbucket diff to extract additions/deletions
                    if (commitDiffData && Array.isArray(commitDiffData)) {
                      let additions = 0;
                      let deletions = 0;

                      commitDiffData.forEach((file) => {
                        if (file.patch) {
                          const lines = file.patch.split('\n');
                          lines.forEach((line) => {
                            if (
                              line.startsWith('+') &&
                              !line.startsWith('+++')
                            ) {
                              additions++;
                            } else if (
                              line.startsWith('-') &&
                              !line.startsWith('---')
                            ) {
                              deletions++;
                            }
                          });
                        }
                      });

                      actualStats = { additions, deletions };
                      console.log(
                        'Retrieved actual diff stats from Bitbucket:',
                        actualStats,
                      );
                    }
                  } catch (bitbucketError) {
                    console.log(
                      'Failed to fetch Bitbucket diff stats:',
                      bitbucketError.message,
                    );
                  }
                }
              }
            }
          }
        } catch (error) {
          console.log(
            'Failed to fetch actual diff stats, using file count fallback:',
            error.message,
          );
        }

        // Handle GitHub webhook push event structure
        normalizedData = {
          sha: data.id,
          files: [
            ...(data.added || []).map((file) => ({
              filename: file,
              status: 'added',
              patch: null,
            })),
            ...(data.modified || []).map((file) => ({
              filename: file,
              status: 'modified',
              patch: null,
            })),
            ...(data.removed || []).map((file) => ({
              filename: file,
              status: 'removed',
              patch: null,
            })),
          ],
          stats: actualStats, // Use actual line diff stats instead of file counts
          commit: {
            message: data.message,
          },
          author: {
            login:
              data.author?.username ||
              data.author?.login ||
              data.author?.name ||
              'Unknown',
          },
          branchName: data.branchName,
        };
      } else {
        // Handle PR commit structure (existing)
        normalizedData = data;
      }
      console.log('normalizedData: ', normalizedData);

      let filesPatch = {};
      // Parse git diff if needed (only for PR commits with patches)
      if (
        normalizedData.files.length > 0 &&
        !normalizedData.files[0].filename &&
        !isWebhookData
      ) {
        filesPatch = parseGitDiffByFile(
          normalizedData.files,
          normalizedData.patch,
        );
      }

      // Prepare files for analysis with enhanced context
      const filesToAnalyze = normalizedData.files.map((file) => {
        if (file.filename) {
          return {
            fileName: file.filename,
            patch: file.patch,
            status: file.status || 'modified',
          };
        }
        return {
          fileName: file,
          patch: filesPatch[file],
          status: 'modified',
        };
      });

      // **ENHANCED DETAILED COMMIT SUMMARY GENERATION**
      let detailedSummary;

      if (isWebhookData) {
        // For webhook data, we need to get repository credentials to fetch commit diff
        try {
          // Get repository information to determine platform and get credentials
          const repository = await this._prismaService.repository.findFirst({
            where: { repositoryId },
            include: {
              organization: true,
            },
          });

          if (repository) {
            // Get organization account for credentials
            const organizationAccount =
              await this._prismaService.organizationAccounts.findFirst({
                where: {
                  organizationId: repository.organizationId,
                  role: 'ADMIN',
                },
              });

            if (organizationAccount) {
              // Get account credentials for API access
              const { decryptedToken } =
                await this.accountCredentialsService.getAccountToken({
                  accountId: organizationAccount.accountId,
                });

              if (decryptedToken) {
                // Determine platform from repository provider
                const platform =
                  repository.provider === 'BITBUCKET' ? 'bitbucket' : 'github';

                // Get the credential value (token)
                const token = decryptedToken; // Credential value field

                const repositoryInfo = {
                  owner: repository.owner,
                  repo: repository.name,
                  token: token,
                  platform: platform as 'github' | 'bitbucket',
                };

                console.log('repositoryInfo: ', repositoryInfo);

                // For webhook data, create detailed summary with actual commit diff
                detailedSummary = await this.generateDetailedWebhookSummary(
                  normalizedData.commit.message,
                  filesToAnalyze,
                  normalizedData.author.login,
                  normalizedData.sha,
                  repositoryInfo,
                );
              } else {
                // Fallback if no credentials found
                detailedSummary = this.createFallbackDetailedSummary(
                  normalizedData.commit.message,
                  filesToAnalyze,
                  normalizedData.author.login,
                );
              }
            } else {
              // Fallback if no organization account found
              detailedSummary = this.createFallbackDetailedSummary(
                normalizedData.commit.message,
                filesToAnalyze,
                normalizedData.author.login,
              );
            }
          } else {
            // Fallback if repository not found
            detailedSummary = this.createFallbackDetailedSummary(
              normalizedData.commit.message,
              filesToAnalyze,
              normalizedData.author.login,
            );
          }
        } catch (error) {
          console.error(
            'Error getting repository credentials for commit diff:',
            error,
          );
          // Fallback to basic summary if credential lookup fails
          detailedSummary = this.createFallbackDetailedSummary(
            normalizedData.commit.message,
            filesToAnalyze,
            normalizedData.author.login,
          );
        }
      } else {
        // For PR commits with patches, use the enhanced analysis
        detailedSummary = await deepSeek.analyzeCommitSummary(filesToAnalyze);
      }

      const payload = {
        commitId: normalizedData.sha,
        committer: normalizedData.author.login,
        additions: normalizedData.stats?.additions || 0,
        deletions: normalizedData.stats?.deletions || 0,
        totalFiles: normalizedData.files.length,
        repositoryId: repositoryId,
        reportId: reportId || null,
        commitMessage: normalizedData.commit.message,
        branchName: normalizedData.branchName || null,
        isMerged:
          data.branchName === 'main' ||
          data.branchName === 'master' ||
          data.branchName === data.baseBranch,
        mergedAt:
          data.branchName === 'main' ||
          data.branchName === 'master' ||
          data.branchName === data.baseBranch
            ? new Date()
            : null,
        summary: detailedSummary, // Just the detailed summary, no complex structure
      };

      const commitSummary = await this._prismaService.commitSummary.create({
        data: { ...payload },
      });

      console.log(
        `Detailed commit analysis completed in ${Date.now() - startTime}ms for commit ${normalizedData.sha}`,
      );

      // Generate and store embedding for semantic search
      await this.generateCommitEmbedding(commitSummary.id);

      return commitSummary;
    } catch (error) {
      console.log('Error in createCommitSummary:', error.message);
      throw new BadRequestException(error.message);
    }
  }

  // New method to create standalone commit summary from push event
  async createStandaloneCommitSummary(commitData, repositoryId: string) {
    try {
      // Get repository details to check base branch
      const repository = await this._prismaService.repository.findUnique({
        where: { repositoryId },
      });

      // Check if this commit is on the base branch
      const branchName = commitData.ref?.replace('refs/heads/', '') || null;
      const isBaseBranch = repository && branchName === repository.baseBranch;

      // Extract module changes from file lists
      const moduleChanges = this.extractModuleChanges(
        commitData.added.concat(commitData.modified, commitData.removed),
      );

      const totalFiles =
        (commitData.added?.length || 0) +
        (commitData.modified?.length || 0) +
        (commitData.removed?.length || 0);

      let aiSummary = null;

      // Generate AI summary using commit message and file changes
      try {
        const deepSeek = new DeepSeek();

        // Create analysis data from webhook information
        const filesToAnalyze = [];

        // Add file information from webhook with scale context
        const changeScale =
          totalFiles <= 3 ? 'small' : totalFiles <= 10 ? 'medium' : 'large';

        if (commitData.added && commitData.added.length > 0) {
          commitData.added.forEach((fileName) => {
            filesToAnalyze.push({
              fileName: fileName,
              patch: `+++ Added: ${fileName}\nCommit: ${commitData.message}\nScale: ${changeScale} change (${totalFiles} files total)`,
            });
          });
        }

        if (commitData.modified && commitData.modified.length > 0) {
          commitData.modified.forEach((fileName) => {
            filesToAnalyze.push({
              fileName: fileName,
              patch: `~~~ Modified: ${fileName}\nCommit: ${commitData.message}\nScale: ${changeScale} change (${totalFiles} files total)`,
            });
          });
        }

        if (commitData.removed && commitData.removed.length > 0) {
          commitData.removed.forEach((fileName) => {
            filesToAnalyze.push({
              fileName: fileName,
              patch: `--- Removed: ${fileName}\nCommit: ${commitData.message}\nScale: ${changeScale} change (${totalFiles} files total)`,
            });
          });
        }

        // Use AI to analyze the commit with available data
        if (filesToAnalyze.length > 0) {
          aiSummary = await deepSeek.analyzeCommitSummary(filesToAnalyze);
        } else {
          // Fallback summary
          aiSummary = {
            Summary: `# Commit Summary\n\n### Changes Overview\n- ${commitData.message}\n\n### Impact\n- Commit affected ${moduleChanges.length} modules`,
          };
        }
      } catch (aiError) {
        console.log('AI analysis failed, using fallback:', aiError.message);
        aiSummary = {
          Summary: `# Commit Summary\n\n### Changes Overview\n- ${commitData.message}\n\n### Files Changed\n- Added: ${commitData.added?.length || 0} files\n- Modified: ${commitData.modified?.length || 0} files\n- Removed: ${commitData.removed?.length || 0} files`,
        };
      }

      const payload: any = {
        commitId: commitData.id,
        committer:
          commitData.author.name || commitData.committer?.name || 'Unknown',
        additions: commitData.added?.length || 0,
        deletions: commitData.removed?.length || 0,
        totalFiles: totalFiles,
        repositoryId: repositoryId,
        reportId: null, // No report ID for standalone commits
        commitMessage: commitData.message,
        summary: aiSummary,
      };

      // Add new fields only if they exist in the schema
      try {
        payload.branchName = branchName;
        payload.isMerged = isBaseBranch; // Auto-merge if on base branch
        payload.moduleChanges = moduleChanges;
        payload.commitUrl = commitData.url;
        payload.parentCommitId =
          commitData.parents?.[0]?.sha || commitData.parents?.[0] || null;

        // Set mergedAt if auto-merged
        if (isBaseBranch) {
          payload.mergedAt = new Date();
        }
      } catch (error) {
        // Ignore errors for optional fields that might not exist in schema yet
        console.log('Optional fields not available in schema:', error.message);
      }

      const commitSummary = await this._prismaService.commitSummary.create({
        data: { ...payload },
      });

      console.log(
        `Standalone commitSummary created: ${commitSummary.id} ${isBaseBranch ? '(auto-merged)' : ''}`,
      );

      // Generate and store embedding for semantic search
      try {
        await this.generateCommitEmbedding(commitSummary.id);
      } catch (embeddingError) {
        console.log('Embedding generation failed:', embeddingError.message);
      }

      return commitSummary;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  // Helper method to extract module changes from file paths
  private extractModuleChanges(files: any[]): string[] {
    const modules = new Set<string>();

    files.forEach((file) => {
      const fileName = file.filename || file;
      const pathParts = fileName.split('/');
      if (pathParts.length > 1) {
        modules.add(pathParts[0]); // Top-level directory
      }
    });

    return Array.from(modules);
  }

  // Helper method to generate basic summary when AI fails
  private generateBasicSummary(
    commitData: any,
    moduleChanges: string[],
  ): string {
    const totalFiles =
      (commitData.added?.length || 0) +
      (commitData.modified?.length || 0) +
      (commitData.removed?.length || 0);

    let summary = `Commit affects ${totalFiles} file(s)`;

    if (commitData.added?.length > 0) {
      summary += `, added ${commitData.added.length} file(s)`;
    }
    if (commitData.modified?.length > 0) {
      summary += `, modified ${commitData.modified.length} file(s)`;
    }
    if (commitData.removed?.length > 0) {
      summary += `, removed ${commitData.removed.length} file(s)`;
    }

    if (moduleChanges.length > 0) {
      summary += `. Modules affected: ${moduleChanges.join(', ')}`;
    }

    return summary;
  }

  // Method to associate commits with a report when PR is created
  async associateCommitsWithReport(commitIds: string[], reportId: string) {
    try {
      const updateData: any = {
        reportId: reportId,
      };

      // Add new fields only if they exist in the schema
      try {
        updateData.isMerged = true;
        updateData.mergedAt = new Date();
      } catch (error) {
        // Ignore errors for optional fields that might not exist in schema yet
        console.log('Optional fields not available in schema:', error.message);
      }

      await this._prismaService.commitSummary.updateMany({
        where: {
          commitId: {
            in: commitIds,
          },
          reportId: null, // Only update commits that don't have a report yet
        },
        data: updateData,
      });

      return {
        success: true,
        message: `Associated ${commitIds.length} commits with report ${reportId}`,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getCommitsByDateRange(
    repositoryId: string,
    startDate: Date,
    endDate: Date,
  ) {
    try {
      // First get repository and check subscription
      const repository = await this._prismaService.repository.findUnique({
        where: { repositoryId },
        include: {
          organization: true,
        },
      });

      if (!repository) {
        throw new BadRequestException('Repository not found');
      }

      // Check if organization has active subscription
      const subscriptionStatus =
        await this._billingService.checkSubscriptionStatus(
          repository.organization.id,
        );

      if (!subscriptionStatus.isActive) {
        throw new BadRequestException(
          subscriptionStatus.message ||
            'Active subscription required to access commits',
        );
      }

      const commits = await this._prismaService.commitSummary.findMany({
        where: {
          repositoryId: repositoryId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return commits;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getDailyProgressAnalytics(repositoryId: string, days: number = 30) {
    try {
      // First get repository and check subscription
      const repository = await this._prismaService.repository.findUnique({
        where: { repositoryId },
        include: {
          organization: true,
        },
      });

      if (!repository) {
        throw new BadRequestException('Repository not found');
      }

      // Check if organization has active subscription
      const subscriptionStatus =
        await this._billingService.checkSubscriptionStatus(
          repository.organization.id,
        );

      if (!subscriptionStatus.isActive) {
        throw new BadRequestException(
          subscriptionStatus.message ||
            'Active subscription required to access analytics',
        );
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const commits = await this._prismaService.commitSummary.findMany({
        where: {
          repositoryId: repositoryId,
          createdAt: {
            gte: startDate,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Group commits by date
      const dailyProgress = commits.reduce((acc, commit) => {
        const date = commit.createdAt.toISOString().split('T')[0];
        if (!acc[date]) {
          acc[date] = {
            date,
            commits: 0,
            additions: 0,
            deletions: 0,
            contributors: new Set(),
            modules: new Set(),
          };
        }

        acc[date].commits += 1;
        acc[date].additions += commit.additions || 0;
        acc[date].deletions += commit.deletions || 0;
        acc[date].contributors.add(commit.committer);

        // Handle moduleChanges field defensively
        try {
          const moduleChanges = (commit as any).moduleChanges || [];
          if (Array.isArray(moduleChanges)) {
            moduleChanges.forEach((module) => acc[date].modules.add(module));
          }
        } catch {
          // Field might not exist in schema yet
        }

        return acc;
      }, {});

      // Convert to array and sort by date
      const dailyProgressArray = Object.values(dailyProgress)
        .map((day: any) => ({
          ...day,
          contributors: Array.from(day.contributors),
          modules: Array.from(day.modules),
        }))
        .sort((a: any, b: any) => a.date.localeCompare(b.date));

      return {
        dailyProgress: dailyProgressArray,
        summary: {
          totalCommits: commits.length,
          totalAdditions: commits.reduce(
            (sum, c) => sum + (c.additions || 0),
            0,
          ),
          totalDeletions: commits.reduce(
            (sum, c) => sum + (c.deletions || 0),
            0,
          ),
          uniqueContributors: Array.from(
            new Set(commits.map((c) => c.committer)),
          ),
          mostActiveModules: this.getMostActiveModules(commits),
        },
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  // Helper method to get most active modules
  private getMostActiveModules(commits: any[]) {
    const moduleActivity = {};

    commits.forEach((commit) => {
      try {
        const moduleChanges = (commit as any).moduleChanges || [];
        if (Array.isArray(moduleChanges)) {
          moduleChanges.forEach((module) => {
            moduleActivity[module] = (moduleActivity[module] || 0) + 1;
          });
        }
      } catch {
        // Field might not exist in schema yet
      }
    });

    return Object.entries(moduleActivity)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([module, count]) => ({ module, count }));
  }

  async getCommits(
    repositoryId: string,
    page: number,
    limit: number,
    branchName: string,
    committer: string,
    isMerged: boolean,
    startDate: string,
    endDate: string,
  ) {
    const repository = await this._prismaService.repository.findUnique({
      where: { id: repositoryId },
      include: {
        organization: true,
      },
    });

    if (!repository) {
      throw new BadRequestException('Repository not found');
    }

    // Check if organization has active subscription
    const subscriptionStatus =
      await this._billingService.checkSubscriptionStatus(
        repository.organization.id,
      );

    if (!subscriptionStatus.isActive) {
      throw new BadRequestException(
        subscriptionStatus.message ||
          'Active subscription required to access commits',
      );
    }

    const skip = (page - 1) * limit;

    const where: any = { repositoryId: repository.repositoryId };

    if (branchName) where.branchName = branchName;
    if (committer)
      where.committer = { contains: committer, mode: 'insensitive' };
    if (isMerged !== undefined) where.isMerged = isMerged === true;
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get paginated results
    const paginatedData = await this.getCommitsPaginated(
      where,
      skip,
      limit.toString(),
    );

    // Get total statistics for all matching records (not just current page)
    const totalStats = await this.getCommitStatistics(where);

    return {
      success: true,
      data: {
        ...paginatedData,
        totalStats,
      },
    };
  }

  // Method to get commits with pagination
  async getCommitsPaginated(where: any, skip: number, limit: string) {
    try {
      const [commits, total] = await Promise.all([
        this._prismaService.commitSummary.findMany({
          where,
          skip,
          take: parseInt(limit),
          orderBy: {
            createdAt: 'desc',
          },
        }),
        this._prismaService.commitSummary.count({
          where,
        }),
      ]);

      console.log('commits:: ', commits);

      return {
        commits,
        total,
        page: Math.floor(skip / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async getCommitStatistics(where: any) {
    try {
      const [allCommits, mergedCommits] = await Promise.all([
        this._prismaService.commitSummary.findMany({
          where,
          select: {
            id: true,
            committer: true,
            createdAt: true,
            additions: true,
            deletions: true,
          },
        }),
        this._prismaService.commitSummary.count({
          where: {
            ...where,
            isMerged: true,
          },
        }),
      ]);

      const totalCommits = allCommits.length;
      const totalContributors = new Set(allCommits.map((c) => c.committer))
        .size;
      const mergeRate =
        totalCommits > 0 ? Math.round((mergedCommits / totalCommits) * 100) : 0;

      // Calculate average commits per day (last 30 days to get better average)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentCommits = allCommits.filter(
        (c) => c.createdAt >= thirtyDaysAgo,
      );

      // Use Math.max to ensure we don't get 0 when there are commits but few
      const averageCommitsPerDay =
        recentCommits.length > 0
          ? Math.max(1, Math.round(recentCommits.length / 30))
          : 0;

      return {
        totalCommits,
        totalContributors,
        mergedCommits,
        mergeRate,
        averageCommitsPerDay,
      };
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
      // First get repository and check subscription
      const repository = await this._prismaService.repository.findUnique({
        where: { repositoryId },
        include: {
          organization: true,
        },
      });

      if (!repository) {
        throw new BadRequestException('Repository not found');
      }

      // Check if organization has active subscription
      const subscriptionStatus =
        await this._billingService.checkSubscriptionStatus(
          repository.organization.id,
        );

      if (!subscriptionStatus.isActive) {
        throw new BadRequestException(
          subscriptionStatus.message ||
            'Active subscription required to search commits',
        );
      }

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

  // New method to generate detailed summaries for webhook commits
  private async generateDetailedWebhookSummary(
    commitMessage: string,
    files: any[],
    author: string,
    commitId: string,
    repositoryInfo: {
      owner: string;
      repo: string;
      token: string;
      platform: 'github' | 'bitbucket';
    },
  ) {
    console.log(
      JSON.stringify(
        { commitMessage, files, author, commitId, repositoryInfo },
        null,
        2,
      ),
    );
    try {
      const deepSeek = new DeepSeek();

      console.log(
        `Fetching commit diff for commit ${commitId} from ${repositoryInfo.platform}`,
      );

      let commitDiffData;
      let filesToAnalyze = [];

      if (repositoryInfo.platform === 'github') {
        // Fetch actual commit diff from GitHub API
        try {
          commitDiffData = await commitInfo({
            owner: repositoryInfo.owner,
            repo: repositoryInfo.repo,
            commitSha: commitId,
            token: `  ${repositoryInfo.token}`,
          });

          console.log('commitDiffData: ', commitDiffData);

          if (commitDiffData?.files) {
            // Extract file changes with actual patch data
            filesToAnalyze = commitDiffData.files.map((file) => ({
              fileName: file.filename,
              patch:
                file.patch ||
                file.content ||
                `File ${file.status}: ${commitMessage}`,
              status: file.status,
              additions: file.additions || 0,
              deletions: file.deletions || 0,
            }));
          }
        } catch (error) {
          console.error('Error fetching GitHub commit diff:', error);
          // Fallback to basic file info if API fails
          filesToAnalyze = files.map((f) => ({
            fileName: f.fileName,
            patch: `File ${f.status}: ${commitMessage}`,
            status: f.status,
          }));
        }
      } else if (repositoryInfo.platform === 'bitbucket') {
        // Fetch actual commit diff from Bitbucket API
        try {
          // For Bitbucket, we need the diff URL - construct it from commit info
          const diffUrl = `https://api.bitbucket.org/2.0/repositories/${repositoryInfo.owner}/${repositoryInfo.repo}/diff/${commitId}`;

          commitDiffData = await commitInfoBitbucket({
            token: repositoryInfo.token,
            commitDiffUrl: diffUrl,
          });

          if (commitDiffData && Array.isArray(commitDiffData)) {
            // Extract file changes with actual patch data
            filesToAnalyze = commitDiffData.map((file) => ({
              fileName: file.filename,
              patch:
                file.patch || file.content || `File modified: ${commitMessage}`,
              status: 'modified', // Bitbucket diff format
            }));
          }
        } catch (error) {
          console.error('Error fetching Bitbucket commit diff:', error);
          // Fallback to basic file info if API fails
          filesToAnalyze = files.map((f) => ({
            fileName: f.fileName,
            patch: `File ${f.status}: ${commitMessage}`,
            status: f.status,
          }));
        }
      } else {
        // Fallback for unknown platforms
        filesToAnalyze = files.map((f) => ({
          fileName: f.fileName,
          patch: `File ${f.status}: ${commitMessage}`,
          status: f.status,
        }));
      }

      console.log(
        `Analyzing ${filesToAnalyze.length} files with diff data for commit ${commitId}`,
      );

      // Use the existing analyzeCommitSummary method with real diff data
      const result = await deepSeek.analyzeCommitSummary(filesToAnalyze);

      // Check if the result is in the expected format, if not create a detailed summary
      if (result && result.Summary) {
        return result;
      } else {
        // If AI doesn't return expected format, create a fallback detailed summary
        return this.createFallbackDetailedSummary(
          commitMessage,
          filesToAnalyze,
          author,
        );
      }
    } catch (error) {
      console.error('Error generating detailed webhook summary:', error);
      return this.createFallbackDetailedSummary(commitMessage, files, author);
    }
  }

  // Helper method to categorize changes
  private categorizeChanges(files: any[]) {
    const categories = {
      'Frontend Components': [],
      'Backend Services': [],
      'Database/Models': [],
      Configuration: [],
      Documentation: [],
      Tests: [],
      Assets: [],
      Other: [],
    };

    files.forEach((file) => {
      const fileName = file.fileName.toLowerCase();

      if (
        fileName.includes('component') ||
        fileName.includes('page') ||
        fileName.includes('view') ||
        fileName.endsWith('.jsx') ||
        fileName.endsWith('.tsx') ||
        fileName.endsWith('.vue')
      ) {
        categories['Frontend Components'].push(file.fileName);
      } else if (
        fileName.includes('service') ||
        fileName.includes('controller') ||
        fileName.includes('api') ||
        fileName.includes('route')
      ) {
        categories['Backend Services'].push(file.fileName);
      } else if (
        fileName.includes('model') ||
        fileName.includes('schema') ||
        fileName.includes('migration') ||
        fileName.endsWith('.sql')
      ) {
        categories['Database/Models'].push(file.fileName);
      } else if (
        fileName.includes('config') ||
        fileName.endsWith('.json') ||
        fileName.endsWith('.yaml') ||
        fileName.endsWith('.yml') ||
        fileName.includes('docker')
      ) {
        categories['Configuration'].push(file.fileName);
      } else if (
        fileName.endsWith('.md') ||
        fileName.includes('readme') ||
        fileName.includes('doc')
      ) {
        categories['Documentation'].push(file.fileName);
      } else if (fileName.includes('test') || fileName.includes('spec')) {
        categories['Tests'].push(file.fileName);
      } else if (
        fileName.includes('asset') ||
        fileName.includes('image') ||
        fileName.includes('static')
      ) {
        categories['Assets'].push(file.fileName);
      } else {
        categories['Other'].push(file.fileName);
      }
    });

    return Object.entries(categories)
      .filter(([, files]) => files.length > 0)
      .map(([category, files]) => ({ category, files }));
  }

  // Helper method to assess commit impact
  private assessCommitImpact(files: any[]): string {
    const fileCount = files.length;

    if (fileCount === 1) {
      return 'Low Impact - Single file change';
    } else if (fileCount <= 3) {
      return 'Medium Impact - Limited scope change';
    } else if (fileCount <= 10) {
      return 'High Impact - Multi-file change';
    } else {
      return 'Very High Impact - Large scale change';
    }
  }

  // Fallback method to create detailed summary when AI fails
  private createFallbackDetailedSummary(
    commitMessage: string,
    files: any[],
    author: string,
  ) {
    const changeCategories = this.categorizeChanges(files);
    const impact = this.assessCommitImpact(files);

    const changesOverview = [];

    changeCategories.forEach((category) => {
      if (category.files.length > 0) {
        changesOverview.push(
          `- **${category.category} Modified**: ${category.files.length} file(s) updated including ${category.files.slice(0, 3).join(', ')}${category.files.length > 3 ? ' and others' : ''}`,
        );
      }
    });

    const summary = `# Commit Summary

### Changes Overview
${changesOverview.join('\n')}
- **Commit Message**: "${commitMessage}"
- **Impact Assessment**: ${impact}
- **Files Affected**: ${files.length} file(s) total

### Key Updates
- Changes made by ${author}
- ${files.filter((f) => f.status === 'added').length} files added
- ${files.filter((f) => f.status === 'modified').length} files modified  
- ${files.filter((f) => f.status === 'removed').length} files removed
- Primary focus: ${changeCategories[0]?.category || 'General improvements'}`;

    return { Summary: summary };
  }
}
