import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global module so PrismaService is a shared singleton across all modules. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
