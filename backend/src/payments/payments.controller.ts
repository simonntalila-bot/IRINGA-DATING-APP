import { Controller, Get, Headers, HttpCode, HttpStatus, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** My payments, contact unlocks and video purchases (spec section 28). */
  @Get('me')
  wallet(@CurrentUser() user: AuthUser) {
    return this.payments.wallet(user.id);
  }

  /** Which gateway is live, and whether real credentials are configured. */
  @Get('provider')
  provider() {
    return this.payments.providerStatus();
  }

  /**
   * Payment provider callback.
   *
   * Public because a gateway cannot present a JWT. Authenticated by whatever
   * the provider uses (HMAC signature + timestamp for the generic/mock drivers,
   * the Daraja IP allow-list for M-Pesa), then replay-checked and
   * amount-checked inside PaymentsService. This is the ONLY path that can
   * create an entitlement.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-timestamp') timestamp: string | undefined,
    @Headers('x-event-id') eventId: string | undefined,
  ) {
    return this.payments.handleWebhookWithHeaders(req.rawBody ?? Buffer.from(''), {
      'x-signature': signature,
      'x-timestamp': timestamp,
      'x-event-id': eventId,
    });
  }
}
