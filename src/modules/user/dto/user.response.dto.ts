import { ApiProperty } from '@nestjs/swagger';

export class UserTaskProgressDto {
  @ApiProperty({ example: true })
  hasConnectedGit: boolean;

  @ApiProperty({ example: true })
  hasCreatedOrganization: boolean;

  @ApiProperty({ example: true })
  hasConnectedRepository: boolean;

  @ApiProperty({ example: true })
  hasScannedRepository: boolean;

  @ApiProperty({ example: true })
  hasAskedQuestion: boolean;

  @ApiProperty({ example: 2 })
  prCount: number;

  @ApiProperty({ example: 60 })
  progressPercentage: number;

  @ApiProperty({ example: false })
  discountClaimed: boolean;
}
