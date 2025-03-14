import { CommentType } from '@prisma/client';

export enum CommentRequestType {
  CODE_ISSUES = 'code_issues',
  SECURITY_ISSUES = 'security_issues',
}

export class RegisterDuplicateCodeRequestDto {
  repositoryId: string;
  file: string;
  content: string;
  line: number;
  duplicateOf: any[];
  prId: string;
}
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
  category?: CommentRequestType;
  pageSize: string;
  currentPage: string;
  prId: string;
}
