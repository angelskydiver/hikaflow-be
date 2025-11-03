import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReportType {
  CONTRIBUTOR = 'CONTRIBUTOR',
  TEAM = 'TEAM',
  PROJECT = 'PROJECT',
  ORGANIZATION = 'ORGANIZATION',
}

export class GenerateWeeklyReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  reportType: ReportType;

  @ApiProperty({ description: 'Start date of the week (ISO format)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date of the week (ISO format)' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: 'Team ID (required for TEAM reports)' })
  @IsString()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Account ID (required for CONTRIBUTOR reports)',
  })
  @IsString()
  @IsOptional()
  accountId?: string;

  @ApiPropertyOptional({
    description: 'Repository ID (required for PROJECT reports)',
  })
  @IsString()
  @IsOptional()
  repositoryId?: string;

  @ApiProperty({ description: 'Organization ID' })
  @IsString()
  organizationId: string;
}

export class GetWeeklyReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  reportType: ReportType;

  @ApiPropertyOptional({ description: 'Team ID' })
  @IsString()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional({ description: 'Account ID' })
  @IsString()
  @IsOptional()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Repository ID' })
  @IsString()
  @IsOptional()
  repositoryId?: string;

  @ApiProperty({ description: 'Organization ID' })
  @IsString()
  organizationId: string;

  @ApiPropertyOptional({
    description: 'Start date (ISO format). If not provided, latest report',
  })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Skip number of records for pagination',
    type: Number,
  })
  @IsOptional()
  skip?: number;

  @ApiPropertyOptional({
    description: 'Take number of records for pagination',
    type: Number,
  })
  @IsOptional()
  take?: number;
}
