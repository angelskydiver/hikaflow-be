export class CreateCommentRequestDto {
  repositoryId: string;
  prId: string;
  content: string;
  line: number;
  file: string;
  issue: string;
  issueCategory: string;
}

export class GetCommentRequestDto {
  repositoryId: string;
  pageSize: string;
  currentPage: string;
}
