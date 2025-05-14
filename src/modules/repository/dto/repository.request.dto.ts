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

  @ApiProperty({ example: 'hikaflow', required: true })
  organizationId: string;

  @ApiProperty({ example: 'discoursefy.com', required: false }) // Assuming the repository name is in the format owner/repoName
  webhookEndpoint: string;
}

export class GithubRepositoryBranches {
  owner: string;
  repo: string;
  organizationId: string;
}

export class GithubRepository {
  organizationId: string;
}

export class UpdateRepositoryRequestDto {
  @ApiProperty({ example: 'main', required: false })
  baseBranch: string;
}
export class UpdateRepositorySettingsPromptRequestDto {
  key: string;
  @ApiProperty({ example: 'optional', required: false })
  prompt: string;
}

export class CreateCustomFlagsRequestDto {
  @ApiProperty({ example: 'Magic Numbers', required: true })
  key: string;

  @ApiProperty({ example: 'optional', required: false })
  prompt: string;

  @ApiProperty({ example: 'optional', required: false })
  description: string;

  @ApiProperty({ example: 'optional', required: false })
  priority: string;

  @ApiProperty({ example: 'optional', required: false })
  active: boolean;

  @ApiProperty({ example: 'optional', required: false })
  category: string;
}
