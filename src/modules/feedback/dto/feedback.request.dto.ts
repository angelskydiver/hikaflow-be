import { IsString } from 'class-validator';

export class CollectIgnoreFeedbackRequestDto {
  @IsString()
  commentId: string;

  @IsString()
  issue: string;

  @IsString()
  issueCategory: string;

  @IsString()
  reason: string;

  @IsString()
  repositoryId: string;

  @IsString()
  organizationId: string;
}

export class DisableAnalysisRuleRequestDto {
  @IsString()
  repositoryId: string;

  @IsString()
  issue: string;
}

export class EnableAnalysisRuleRequestDto {
  @IsString()
  repositoryId: string;

  @IsString()
  issue: string;
}
