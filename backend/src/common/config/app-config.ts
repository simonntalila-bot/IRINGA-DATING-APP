import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Typed access to environment configuration with fail-fast validation.
 * Secrets are read here and NEVER returned by any controller.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService) {
    this.assertProductionSecrets();
  }

  private str(key: string, fallback?: string): string {
    const value = this.config.get<string>(key);
    if (value === undefined || value === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }

  private num(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${key} must be a number`);
    return parsed;
  }

  private bool(key: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }

  private assertProductionSecrets(): void {
    if (this.config.get<string>('NODE_ENV') !== 'production') return;

    const weak = [
      ['JWT_SECRET', this.config.get<string>('JWT_SECRET')],
      ['JWT_REFRESH_SECRET', this.config.get<string>('JWT_REFRESH_SECRET')],
      ['PAYMENT_WEBHOOK_SECRET', this.config.get<string>('PAYMENT_WEBHOOK_SECRET')],
    ].filter(([, value]) => !value || (value as string).length < 32 || (value as string).includes('CHANGE_ME'));

    if (weak.length > 0) {
      throw new Error(
        `Refusing to start in production: replace weak or missing secrets -> ${weak.map(([k]) => k).join(', ')}`,
      );
    }
  }

  get nodeEnv(): string {
    return this.str('NODE_ENV', 'development');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.num('PORT', 4000);
  }
  get apiPrefix(): string {
    return this.str('API_PREFIX', 'api/v1');
  }
  get appPublicUrl(): string {
    return this.str('APP_PUBLIC_URL', 'http://localhost:4000');
  }
  get databaseUrl(): string {
    return this.str('DATABASE_URL');
  }
  get redisUrl(): string | undefined {
    return this.config.get<string>('REDIS_URL') || undefined;
  }

  get jwtSecret(): string {
    return this.str('JWT_SECRET');
  }
  get jwtRefreshSecret(): string {
    return this.str('JWT_REFRESH_SECRET', this.jwtSecret);
  }

  /**
   * Key protecting phone/WhatsApp numbers at rest. Falling back to the JWT
   * secret keeps development working; production must set it explicitly
   * (rotating it later means re-encrypting stored numbers).
   */
  get phoneEncryptionKey(): string {
    return this.str('PHONE_ENCRYPTION_KEY', this.jwtSecret);
  }
  get jwtAccessTtl(): string {
    return this.str('JWT_ACCESS_TTL', '15m');
  }
  get jwtRefreshTtlDays(): number {
    return this.num('JWT_REFRESH_TTL_DAYS', 30);
  }

  // Media ------------------------------------------------------------------
  get r2AccountId(): string | undefined {
    return this.config.get<string>('R2_ACCOUNT_ID') || undefined;
  }
  get r2AccessKeyId(): string | undefined {
    return this.config.get<string>('R2_ACCESS_KEY_ID') || undefined;
  }
  get r2SecretAccessKey(): string | undefined {
    return this.config.get<string>('R2_SECRET_ACCESS_KEY') || undefined;
  }
  get r2Bucket(): string {
    return this.str('R2_BUCKET', 'iringa-media');
  }
  get r2Endpoint(): string | undefined {
    return this.config.get<string>('R2_ENDPOINT') || undefined;
  }
  get r2PublicBaseUrl(): string | undefined {
    return this.config.get<string>('R2_PUBLIC_BASE_URL') || undefined;
  }
  get r2SignedUrlTtlSeconds(): number {
    return this.num('R2_SIGNED_URL_TTL_SECONDS', 900);
  }
  get mediaLocalDriver(): string {
    return this.str('MEDIA_LOCAL_DRIVER', this.r2AccessKeyId ? 'r2' : 'local');
  }
  get mediaLocalDir(): string {
    return this.str('MEDIA_LOCAL_DIR', './uploads');
  }
  get maxImageBytes(): number {
    return this.num('MEDIA_MAX_IMAGE_BYTES', 5 * 1024 * 1024);
  }
  get maxVideoBytes(): number {
    return this.num('MEDIA_MAX_VIDEO_BYTES', 100 * 1024 * 1024);
  }
  get maxAudioBytes(): number {
    return this.num('MEDIA_MAX_AUDIO_BYTES', 25 * 1024 * 1024);
  }

  // Push -------------------------------------------------------------------
  get fcmServiceAccountPath(): string | undefined {
    return this.config.get<string>('FCM_SERVICE_ACCOUNT_PATH') || undefined;
  }
  get fcmDryRun(): boolean {
    return this.bool('FCM_DRY_RUN', false);
  }

  // Geography --------------------------------------------------------------
  get iringaCenterLat(): number {
    return this.num('IRINGA_CENTER_LAT', -7.7669);
  }
  get iringaCenterLng(): number {
    return this.num('IRINGA_CENTER_LNG', 35.2313);
  }
  get discoveryDefaultRadiusKm(): number {
    return this.num('DISCOVERY_DEFAULT_RADIUS_KM', 50);
  }
  get locationMinUpdateIntervalSeconds(): number {
    return this.num('LOCATION_MIN_UPDATE_INTERVAL_SECONDS', 900);
  }
  get geofenceDefaultRadiusM(): number {
    return this.num('GEOFENCE_DEFAULT_RADIUS_M', 150);
  }

  // Compatibility weights --------------------------------------------------
  get compatWeights() {
    return {
      goal: this.num('COMPAT_WEIGHT_GOAL', 30),
      distance: this.num('COMPAT_WEIGHT_DISTANCE', 20),
      interests: this.num('COMPAT_WEIGHT_INTERESTS', 25),
      age: this.num('COMPAT_WEIGHT_AGE', 15),
      language: this.num('COMPAT_WEIGHT_LANGUAGE', 5),
      activity: this.num('COMPAT_WEIGHT_ACTIVITY', 5),
    };
  }

  // Payments ---------------------------------------------------------------
  get paymentProvider(): string {
    return this.str('PAYMENT_PROVIDER', 'mock');
  }
  get paymentWebhookSecret(): string {
    return this.str('PAYMENT_WEBHOOK_SECRET', this.jwtSecret);
  }
  get paymentReferencePrefix(): string {
    return this.str('PAYMENT_REFERENCE_PREFIX', 'pay_');
  }
  get paymentGatewayCheckoutUrl(): string | undefined {
    return this.config.get<string>('PAYMENT_GATEWAY_CHECKOUT_URL') || undefined;
  }
  get paymentGatewayCallbackUrl(): string | undefined {
    return this.config.get<string>('PAYMENT_GATEWAY_CALLBACK_URL') || undefined;
  }

  // --- M-Pesa (Safaricom Daraja) ----------------------------------------
  get mpesaBaseUrl(): string {
    // Sandbox by default. Production must point at api.safaricom.co.ke.
    return this.str('MPESA_BASE_URL', 'https://sandbox.safaricom.co.ke');
  }
  get mpesaConsumerKey(): string {
    return this.str('MPESA_CONSUMER_KEY');
  }
  get mpesaConsumerSecret(): string {
    return this.str('MPESA_CONSUMER_SECRET');
  }
  get mpesaShortcode(): string {
    return this.str('MPESA_SHORTCODE');
  }
  get mpesaPasscode(): string {
    return this.str('MPESA_PASSCODE');
  }
  get mpesaCallbackUrl(): string {
    return this.str('MPESA_CALLBACK_URL', `${this.appPublicUrl}/api/v1/payments/webhook`);
  }

  get corsOrigins(): string[] {
    const raw = this.str('CORS_ORIGINS', 'http://localhost:8081');
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get adminEmail(): string | undefined {
    return this.config.get<string>('ADMIN_EMAIL') || undefined;
  }
  get adminPassword(): string | undefined {
    return this.config.get<string>('ADMIN_PASSWORD') || undefined;
  }
}
