import { PrTrackerStatus } from '@prisma/client';

export class RegisterTrackerRequestDto {
  prId: string;
  status: PrTrackerStatus;
  response: any;
}
