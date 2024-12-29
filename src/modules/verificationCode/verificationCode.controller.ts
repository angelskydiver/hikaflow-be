import { Controller } from '@nestjs/common';
import { VerificationCodeService } from './verificationCode.service';

@Controller()
export class VerificationCodeController {
  constructor(
    private readonly _verificationCodeService: VerificationCodeService,
  ) {}
}
