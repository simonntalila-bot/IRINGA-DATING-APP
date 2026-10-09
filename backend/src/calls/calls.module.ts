import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatModule } from '../chat/chat.module';
import { EntitlementModule } from '../entitlements/entitlement.module';
import { CallsController } from './calls.controller';
import { CallsGateway } from './calls.gateway';
import { CallsService } from './calls.service';

/**
 * Calls reuses ChatModule's authenticated socket session, so the gateway does
 * not re-implement the handshake. ChatModule does not import this one, so there
 * is no cycle.
 */
@Module({
  imports: [EntitlementModule, ChatModule, JwtModule.register({})],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway],
  exports: [CallsService],
})
export class CallsModule {}
