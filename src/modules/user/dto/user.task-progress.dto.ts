import { ApiProperty } from '@nestjs/swagger';

export class UserTaskProgressDto {
  @ApiProperty({
    description: 'Whether the user has connected their Git account',
  })
  hasConnectedGit: boolean;

  @ApiProperty({ description: 'Whether the user has created an organization' })
  hasCreatedOrganization: boolean;

  @ApiProperty({ description: 'Whether the user has connected a repository' })
  hasConnectedRepository: boolean;

  @ApiProperty({ description: 'Whether the user has scanned their repository' })
  hasScannedRepository: boolean;

  @ApiProperty({ description: 'Whether the user has asked a question' })
  hasAskedQuestion: boolean;

  @ApiProperty({ description: 'Number of pull requests created' })
  prCount: number;

  @ApiProperty({ description: 'Overall progress percentage' })
  progressPercentage: number;

  @ApiProperty({ description: 'Whether the user has claimed their discount' })
  discountClaimed: boolean;
}
