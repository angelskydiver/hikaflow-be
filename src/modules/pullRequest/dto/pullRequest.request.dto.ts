export class RegisterPullRequestDto {
  repositoryId: string;
  prUrl: string;
  prNumber: number;
  prTitle: string;
  prDescription?: string;
  head: string;
  base: string;
  summary?: any;
}

export class GetPullRequestDto {
  repositoryId: string;
  pageNumber: string;
  pageSize: string;
}
