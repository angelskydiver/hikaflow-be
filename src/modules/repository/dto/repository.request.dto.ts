import { ApiProperty } from '@nestjs/swagger';
import { RepositoryProvider } from '@prisma/client';

export class RegisterRepositoryRequestDto {
  @ApiProperty({ example: 'GITHUB' })
  provider: RepositoryProvider;

  @ApiProperty({ example: '0992340' })
  repositoryId: string;

  @ApiProperty({ example: 'Repository Name' })
  name: string;

  @ApiProperty({ example: false, required: false })
  private: boolean;

  @ApiProperty({ example: 'optional', required: false })
  description: string;

  @ApiProperty({ example: 'TypeScript', required: false })
  language: string;

  @ApiProperty({ example: 'ownerName', required: true }) // Assuming the owner is an account id
  owner: string;

  @ApiProperty({ example: 'main', required: true })
  baseBranch: string;

  @ApiProperty({ example: 'discoursefy.com', required: false }) // Assuming the repository name is in the format owner/repoName
  webhookEndpoint: string;
}

export class GithubRepositoryBranches {
  owner: string;
  repo: string;
}

export class UpdateRepositoryRequestDto {
  @ApiProperty({ example: 'main', required: false })
  baseBranch: string;
}
