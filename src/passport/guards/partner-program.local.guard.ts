import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class PartnerProgramLocalAuthGuard extends AuthGuard(
  'partner-program-local',
) {}
