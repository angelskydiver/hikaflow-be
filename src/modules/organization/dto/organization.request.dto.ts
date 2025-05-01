import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { OrganizationalAccountRole } from './../../../../node_modules/.prisma/client/index.d';

export class CreateOrganizationRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description: string;
}

export class InviteUserToOrganizationRequestDTO {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ type: [Object] })
  @IsArray()
  users: {
    email: string;
    name: string;
    role: string;
  }[];
}

export class InviteUserDTO {
  name: string;
  email: string;
  role: OrganizationalAccountRole;
}

export class OrganizationInsightsQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  repositoryId?: string;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  daysLimit?: number = 30;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  prLimit?: number = 5;
}
