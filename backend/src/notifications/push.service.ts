import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { existsSync, readFileSync } from 'node:fs';
import { AppConfig } from '../common/config/app-config';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Push transport abstraction.
 *
 * Firebase Cloud Messaging is the production driver. When no service account is
 * configured the transport becomes a no-op logger so local development and CI
 * never fail because of missing credentials. Credentials are read from a file
 * path in the environment and never from source control.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private app: admin.app.App | null = null;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    const path = this.config.fcmServiceAccountPath;
    if (!path || !existsSync(path)) {
      this.logger.warn('FCM not configured - push notifications will be logged only');
      return;
    }
    try {
      const serviceAccount = JSON.parse(readFileSync(path, 'utf8')) as admin.ServiceAccount;
      this.app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      this.logger.log('FCM initialised');
    } catch (error) {
      this.logger.error(`FCM initialisation failed: ${(error as Error).message}`);
    }
  }

  get enabled(): boolean {
    return this.app !== null;
  }

  async send(messages: PushMessage[]): Promise<void> {
    if (messages.length === 0) return;

    if (!this.app) {
      this.logger.log(`[PUSH DISABLED] ${messages.length} message(s): ${messages[0].title}`);
      return;
    }

    await Promise.all(
      messages.map(async (message) => {
        try {
          await this.app!.messaging().send({
            token: message.token,
            notification: { title: message.title, body: message.body },
            data: message.data ?? {},
            android: { priority: 'high', notification: { channelId: 'default' } },
          });
        } catch (error) {
          this.logger.warn(`Push failed: ${(error as Error).message}`);
        }
      }),
    );
  }
}
