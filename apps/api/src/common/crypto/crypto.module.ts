import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** Global module so CryptoService is a shared singleton across all modules. */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
