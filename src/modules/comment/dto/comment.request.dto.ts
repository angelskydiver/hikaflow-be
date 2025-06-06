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
  prId?: string;
  content: string;
  line: number;
  file: string;
  issue: string;
  issueCategory: string;
  severity: string;
  type: CommentType;
  reason?: string;

  // Enhanced fields for GitHub Copilot-like suggestions
  enhancementType?: string; // CODE_REPLACEMENT, SUGGESTION, REFACTOR, SECURITY_FIX
  affectedCodeBlock?: {
    startLine: number;
    endLine: number;
    codeLines: string[];
  };
  improvedCodeBlock?: {
    startLine: number;
    endLine: number;
    codeLines: string[];
    explanation: string;
  };
  tags?: string[]; // SECURITY, PERFORMANCE, MAINTAINABILITY, etc.
}

export class GetCommentRequestDto {
  repositoryId: string;
  category?: CommentRequestType;
  pageSize: string;
  currentPage: string;
  prId: string;
}
