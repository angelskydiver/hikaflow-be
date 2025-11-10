import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

export class InviteUserDTO {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  role: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  teamId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  organizationRoleId?: string;
}

export class InviteUserToOrganizationRequestDTO {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ type: [InviteUserDTO] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InviteUserDTO)
  users: InviteUserDTO[];
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
