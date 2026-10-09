import { Module } from '@nestjs/common';
import { PaymentProviderFactory, WebhookGuard } from './payment-provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderFactory, WebhookGuard],
  exports: [PaymentsService, PaymentProviderFactory, WebhookGuard],
})
export class PaymentsModule {}
