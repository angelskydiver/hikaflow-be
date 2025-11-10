import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateUserRequestDto {
  @ApiProperty({ example: 'John' }) // Swagger docs show example data
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: 'password123' })
  password: string;

  @ApiProperty({
    example: 'affiliate-user-uuid',
    description: 'Optional affiliate partner ID for referral tracking',
    required: false,
  })
  @IsOptional()
  @IsString()
  partnerId?: string;

  @ApiProperty({
    example: 'john-doe',
    description: 'Git contributor name (username used in git commits). Optional - can be set later in profile.',
    required: false,
  })
  @IsOptional()
  @IsString()
  gitContributorName?: string;
}

export class LoginRequestDto {
  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: 'password123' })
  password: string;
}

export class VerificationRequestDto {
  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;
}

export class VerifyEmailRequestDto {
  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: '****' })
  code: string;
}

export class VerifyPasswordRequestDto {
  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: 'any_password' })
  newPassword: string;

  @ApiProperty({ example: '****' })
  code: string;
}
