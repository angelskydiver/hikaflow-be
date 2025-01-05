import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  imports: [PrismaModule],
  providers: [OrganizationService],
  controllers: [OrganizationController],
  exports: [OrganizationService],
})
export class OrganizationModule {}
