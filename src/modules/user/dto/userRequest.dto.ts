import { ApiProperty } from '@nestjs/swagger';

export class CreateUserRequestDto {
  @ApiProperty({ example: 'John' }) // Swagger docs show example data
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: 'password123' })
  password: string;
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
