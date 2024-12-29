import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAccountRequestDto } from './dto/account.request.dto';

@Injectable()
export class AccountService {
  constructor(private readonly _prismaService: PrismaService) {}

  async createAccount(data: CreateAccountRequestDto) {
    try {
      return await this._prismaService.account.create({ data });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }

  async updateAccount(id: string, data: any) {
    try {
      let Account = await this._prismaService.account.findFirst({
        where: { id },
      });
      if (!Account) throw new BadRequestException('Account not found');
      return this._prismaService.account.update({ where: { id }, data });
    } catch (error) {
      console.log(error.message);
      throw new BadRequestException(error.message);
    }
  }
}
