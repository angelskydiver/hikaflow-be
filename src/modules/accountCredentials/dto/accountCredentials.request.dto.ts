import { ApiProperty } from '@nestjs/swagger';
import { AccountCredentialsType } from '@prisma/client';

export class RegisterAccountCredentialRequestDto {
  @ApiProperty({ enum: AccountCredentialsType })
  type: AccountCredentialsType;

  @ApiProperty({ example: 'credential' })
  value: string;
}

export class RegisterBitbucketAccountCredentialRequestDto {
  @ApiProperty({ example: 'accountId' })
  accountId: string;

  @ApiProperty({ example: 'clientKey' })
  clientKey: string;
}

export class RetrieveAccountCredentialsRequestDto {
  @ApiProperty({ example: 'accountId' })
  accountId: string;
}
