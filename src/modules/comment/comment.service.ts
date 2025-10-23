import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommentStatus } from '@prisma/client';
import { CommentCategory } from 'src/config/constants/comment.type.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { FeedbackService } from '../feedback/feedback.service';
import {
  CommentRequestType,
  CreateCommentRequestDto,
  GetCommentRequestDto,
  RegisterDuplicateCodeRequestDto,
} from './dto/comment.request.dto';

@Injectable()
export class CommentService {
  constructor(
    private _prismaService: PrismaService,
    private _feedbackService: FeedbackService,
  ) {}

  async registerDuplicateCode(data: RegisterDuplicateCodeRequestDto[]) {
    try {
      console.log('data: ', JSON.stringify(data, null, 2));
      const dataMapping = data.map((duplicateCode) =>
        this._prismaService.duplicatedCode.create({ data: duplicateCode }),
      );
      await Promise.all(dataMapping);
    } catch (error) {
      console.log(error);
      throw new Error('Failed to register duplicate code');
    }
  }

  async fetchRepositoryDuplicateCode(
    accountId: string,
    data: GetCommentRequestDto,
  ) {
    try {
      const whereParams = {
        repositoryId: data.repositoryId,
      };
      const accountRepository =
        await this._prismaService.accountRepository.findFirst({
          where: whereParams,
          include: {
            repository: true,
          },
        });
      if (!accountRepository)
        throw new BadRequestException('Repository not found');
      const repositoryGithubId = accountRepository.repository.repositoryId;
      let pullRequests = null;
      if (data.prId) {
        pullRequests = await this._prismaService.pullRequest.findFirst({
          where: {
            repositoryId: repositoryGithubId,
            prNumber: parseInt(data.prId),
          },
        });
      }
      const comments = await this._prismaService.duplicatedCode.findMany({
        where: {
          repositoryId: accountRepository.repository.id,
          ...(data.prId && { prId: data.prId }),
        },
        skip: (parseInt(data.currentPage) - 1) * parseInt(data.pageSize),
        take: parseInt(data.pageSize),
        orderBy: { createdAt: 'desc' },
      });

      const commentCount = await this._prismaService.duplicatedCode.count({
        where: {
          repositoryId: accountRepository.repository.id,
          ...(data.prId && { prId: data.prId }),
        },
      });

      return { comments: comments, commentCount: commentCount };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async createComment(data: CreateCommentRequestDto): Promise<any> {
    try {
      await this._prismaService.comment.create({
        data: {
          ...data,
          status: CommentStatus.OPEN,
        },
      });
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async fetchRepositoryComments(accountId: string, data: GetCommentRequestDto) {
    try {
      const whereParams = {
        repositoryId: data.repositoryId,
      };
      const repository = await this._prismaService.accountRepository.findFirst({
        where: whereParams,
        include: {
          repository: true,
        },
      });
      if (!repository) throw new BadRequestException('Repository not found');
      const repositoryGithubId = repository.repository.repositoryId;
      let pullRequests = null;

      // Build dynamic where clause based on filters
      let prIdValue = null;
      if (data.prId) {
        pullRequests = await this._prismaService.pullRequest.findFirst({
          where: {
            repositoryId: repositoryGithubId,
            prNumber: parseInt(data.prId),
            summary: { not: '' },
          },
        });
        if (pullRequests) {
          prIdValue = pullRequests.id;
        }
      }

      // Build dynamic where clause based on filters
      const whereClause: any = {
        repositoryId: repositoryGithubId,
        ...(prIdValue && { prId: prIdValue }),
        ...(data.category && {
          issueCategory:
            data.category == CommentRequestType.CODE_ISSUES
              ? {
                  not: {
                    in: [
                      CommentCategory.SecurityConcerns,
                      'Security',
                      'SECURITY',
                    ],
                  },
                }
              : {
                  in: [
                    CommentCategory.SecurityConcerns,
                    'Security',
                    'SECURITY',
                  ],
                },
        }),
      };

      // Handle ignored issues filter
      if (data.showIgnored === undefined || data.showIgnored === false) {
        whereClause.isIgnored = false;
      }

      // Handle issue type filter (Breaking Changes vs Enhancements)
      if (data.issueType) {
        if (data.issueType === 'breaking_changes') {
          // Breaking changes: HIGH severity issues or SecurityConcerns/SeriousIssues
          whereClause.OR = [
            { severity: { in: ['HIGH', 'High'] } },
            // { issueCategory: { in: ['SecurityConcerns', 'SeriousIssues'] } },
          ];
        } else if (data.issueType === 'enhancements') {
          // Enhancements: MEDIUM/LOW severity CodeSmells
          whereClause.AND = [
            { severity: { in: ['MEDIUM', 'LOW', 'Low', 'Medium'] } },
            // { issueCategory: 'CodeSmells' },
          ];
        }
      }

      // Handle severity filter
      if (data.severity) {
        whereClause.severity = data.severity;
      }

      // Handle search term filter
      if (data.searchTerm && data.searchTerm.trim()) {
        const searchTerm = data.searchTerm.trim();
        whereClause.AND = [
          ...(whereClause.AND || []),
          {
            OR: [
              { issue: { contains: searchTerm, mode: 'insensitive' } },
              { file: { contains: searchTerm, mode: 'insensitive' } },
              { content: { contains: searchTerm, mode: 'insensitive' } },
            ],
          },
        ];
      }

      const comments = await this._prismaService.comment.findMany({
        where: whereClause,
        skip: (parseInt(data.currentPage) - 1) * parseInt(data.pageSize),
        take: parseInt(data.pageSize),
        orderBy: { createdAt: 'desc' },
      });

      const commentCount = await this._prismaService.comment.count({
        where: whereClause,
      });

      return { comments: comments, commentCount: commentCount };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async updateComments(commentIds: string[]) {
    try {
      await this._prismaService.comment.updateMany({
        where: {
          id: {
            in: commentIds,
          },
        },
        data: {
          status: CommentStatus.OUTDATED,
        },
      });
      return {
        Success: true,
      };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async ignoreComment(commentId: string, ignoreReason?: string) {
    try {
      // Get comment details for feedback collection
      const comment = await this._prismaService.comment.findUnique({
        where: { id: commentId },
        include: {
          repository: {
            include: {
              organization: true,
            },
          },
        },
      });

      if (!comment) {
        throw new BadRequestException('Comment not found');
      }

      // Update comment status
      await this._prismaService.comment.update({
        where: { id: commentId },
        data: {
          isIgnored: true,
          ignoreReason: ignoreReason || 'User ignored this issue',
          status: CommentStatus.OUTDATED,
        },
      });

      // Collect feedback for AI parameter improvement
      if (comment.repository.organization) {
        await this._feedbackService.collectIgnoreFeedback({
          commentId: comment.id,
          issue: comment.issue,
          issueCategory: comment.issueCategory,
          reason: ignoreReason || 'No reason provided',
          repositoryId: comment.repositoryId,
          organizationId: comment.repository.organization.id,
        });
      }

      return { success: true };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async unignoreComment(commentId: string) {
    try {
      await this._prismaService.comment.update({
        where: { id: commentId },
        data: {
          isIgnored: false,
          ignoreReason: null,
          status: CommentStatus.OPEN,
        },
      });
      return { success: true };
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async checkForDuplicateIssuesInPR(issues: any[]): Promise<any[]> {
    try {
      // Use a Set to track unique issues within the same PR
      const seenIssues = new Set<string>();
      const filteredIssues: any[] = [];

      for (const issue of issues) {
        // Create a unique key for this issue based on file, line, and issue type
        const issueKey = `${issue.file}:${issue.line}:${issue.issue}`;

        if (!seenIssues.has(issueKey)) {
          seenIssues.add(issueKey);
          filteredIssues.push(issue);
        } else {
          console.log(
            `Duplicate issue detected and filtered within PR: ${issue.issue} in ${issue.file}:${issue.line}`,
          );
        }
      }

      return filteredIssues;
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async reformatCommentAnalysis(commentId: string): Promise<any> {
    try {
      // Get the comment
      const comment = await this._prismaService.comment.findUnique({
        where: { id: commentId },
        include: {
          repository: true,
        },
      });

      if (!comment) {
        throw new NotFoundException('Comment not found');
      }

      // Call Gemini to reformat the analysis
      const { Gemini } = await import(
        '../../config/helpers/ai/gemini.ai.helper'
      );
      const gemini = new Gemini();

      const reformatPrompt = `You are a markdown formatting expert. Please reformat the following code analysis to improve its visual structure and readability WITHOUT changing any content, meaning, or technical details.

FORMATTING REQUIREMENTS:
1. Fix markdown syntax (headers, lists, code blocks, etc.)
2. Add proper spacing between sections
3. Use consistent formatting for similar elements
4. Improve visual hierarchy with proper headings
5. Format code blocks with proper syntax highlighting
6. Use bullet points and numbered lists where appropriate
7. Ensure proper line breaks and paragraph spacing

CONTENT REQUIREMENTS:
- DO NOT change any technical details
- DO NOT rephrase or rewrite content
- DO NOT add new information
- DO NOT remove existing information
- ONLY improve the markdown formatting and structure, NO NEED TO ADD EXTRA INFORMATION, Acknowledgement, etc.

Correct EXAMPLE:
Issue Analysis
Problem: <Problem description>

Impact: <Impact description>

Solution: <Solution description>

Benefits: <Benefits description>

Wrong EXAMPLE:
Of course. Here is the reformatted analysis with improved visual structure and readability.<I don't need any of this line>

🔍 Issue Analysis
Problem: <Problem description>.

Impact: <Impact description>.

Solution: <Solution description>.

Benefits: <Benefits description>.

Original Analysis:
${comment.reason}

Please provide the reformatted analysis with improved markdown formatting:`;

      const geminiResponse = await gemini.generateAnswer(reformatPrompt, []);
      const reformattedReason = geminiResponse.output.response.text();

      // Update the comment with reformatted reason
      const updatedComment = await this._prismaService.comment.update({
        where: { id: commentId },
        data: {
          reason: reformattedReason,
        },
        include: {
          repository: true,
        },
      });

      return updatedComment;
    } catch (error) {
      console.error('Error reformatting comment analysis:', error);
      throw new BadRequestException('Failed to reformat analysis');
    }
  }
}
