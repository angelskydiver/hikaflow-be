import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AffiliateUserService } from 'src/modules/affiliateUser/affiliateUser.service';

@Injectable()
export class PartnerProgramLocalAuthStrategy extends PassportStrategy(
  Strategy,
  'partner-program-local',
) {
  constructor(private _affiliateUserService: AffiliateUserService) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  async validate(email: string, password: string): Promise<any> {
    try {
      const user = await this._affiliateUserService.validateUser({
        email,
        plainPassword: password,
      });

      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      return user;
    } catch (error) {
      console.log('Partner program auth error:', error.message);
      throw new UnauthorizedException('Invalid credentials');
    }
  }
}
