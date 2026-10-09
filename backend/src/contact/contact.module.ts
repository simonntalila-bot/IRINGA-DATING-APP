import { Module } from '@nestjs/common';
import { EntitlementModule } from '../entitlements/entitlement.module';
import { PaymentsModule } from '../payments/payments.module';
import { ContactController } from './contact.controller';
import { ContactUnlockService } from './contact-unlock.service';

@Module({
  imports: [PaymentsModule, EntitlementModule],
  controllers: [ContactController],
  providers: [ContactUnlockService],
  exports: [ContactUnlockService],
})
export class ContactModule {}
