import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { KycStatus } from './kyc.types';

/** Default OneSignal REST API endpoint */
const DEFAULT_ONESIGNAL_API_URL = 'https://onesignal.com/api/v1/notifications';

/** Notification content constants */
const NOTIFICATION_HEADING = 'KYC Verification Update';
const NOTIFICATION_VERIFIED_MESSAGE = 'Your identity has been verified successfully!';
const NOTIFICATION_REJECTED_MESSAGE = 'Your identity verification was not successful. Please try again.';

/**
 * KYC push notification service.
 * Sends OneSignal push notifications when KYC status changes to VERIFIED or REJECTED.
 * Gracefully handles missing configuration and network errors without crashing the pipeline.
 */
@Injectable()
export class KycNotificationService {
  private readonly logger = new Logger(KycNotificationService.name);
  private readonly oneSignalAppId: string | null;
  private readonly oneSignalApiKey: string | null;
  private readonly oneSignalApiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.oneSignalAppId = this.configService.get<string>('ONESIGNAL_APP_ID') ?? null;
    this.oneSignalApiKey = this.configService.get<string>('ONESIGNAL_API_KEY') ?? null;
    this.oneSignalApiUrl = this.configService.get<string>('ONESIGNAL_API_URL') ?? DEFAULT_ONESIGNAL_API_URL;
  }

  /**
   * Send push notification for a KYC status change.
   * Skips silently when OneSignal is not configured.
   * Never throws — notification failures must not break the KYC pipeline.
   *
   * @param userId - Target user external ID
   * @param status - New KYC status (VERIFIED or REJECTED)
   * @param rejectionReason - Optional reason when status is REJECTED
   */
  async notifyStatusChange(
    userId: string,
    status: KycStatus,
    rejectionReason?: string,
  ): Promise<void> {
    if (!this.oneSignalAppId || !this.oneSignalApiKey) {
      this.logger.debug('OneSignal not configured, skipping push notification');
      return;
    }

    try {
      const message = status === KycStatus.VERIFIED
        ? NOTIFICATION_VERIFIED_MESSAGE
        : NOTIFICATION_REJECTED_MESSAGE;

      const data: Record<string, string> = {
        type: 'kyc_status_change',
        status,
      };

      if (status === KycStatus.REJECTED && rejectionReason) {
        data.rejectionReason = rejectionReason;
      }

      await axios.post(
        this.oneSignalApiUrl,
        {
          app_id: this.oneSignalAppId,
          include_external_user_ids: [userId],
          contents: { en: message },
          headings: { en: NOTIFICATION_HEADING },
          data,
        },
        {
          headers: {
            Authorization: `Basic ${this.oneSignalApiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Push notification sent to user ${userId} for status ${status}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Failed to send push notification to user ${userId}: ${errorMsg}`);
    }
  }
}
