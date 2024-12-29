// import { PassportStrategy } from '@nestjs/passport';
// import { Strategy, VerifyCallback } from 'passport-google-oauth20';
// import { Injectable } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';

// @Injectable()
// export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
//   constructor(private configService: ConfigService) {
//     super({
//       clientID: configService.get<string>('CLIENT_ID'),
//       clientSecret: configService.get<string>('CLIENT_SECRET'),
//       callbackURL: configService.get<string>('REDIRECT_URL'),
//       scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
//     });
//   }
//   async validate(
//     accessToken: string,
//     refreshToken: string,
//     profile: any,
//     done: VerifyCallback,
//   ): Promise<any> {
//     console.log('Google at: ', accessToken)
//     console.log('Google rt: ', refreshToken)

//     const { name, emails, photos } = profile;
//     const user = {
//       email: emails[0].value,
//       firstName: name.givenName,
//       lastName: name.familyName,
//       picture: photos[0].value,
//       accessToken,
//       refreshToken,
//     };
//     done(null, user);
//   }
// }
