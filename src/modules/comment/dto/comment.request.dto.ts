import { CommentType } from '@prisma/client';

export class CreateCommentRequestDto {
  repositoryId: string;
  prId: string;
  content: string;
  line: number;
  file: string;
  issue: string;
  issueCategory: string;
  severity: string;
  type: CommentType;
}

export class GetCommentRequestDto {
  repositoryId: string;
  pageSize: string;
  currentPage: string;
  prId: string;
}
