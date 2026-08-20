import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OcrRequest,
  OcrResult,
  FaceCompareRequest,
  FaceCompareResult,
  LivenessRequest,
  LivenessResult,
} from './ai-client.types';

/**
 * Client service for communicating with the FastAPI AI service.
 * Handles OCR, face comparison, and liveness detection requests.
 * All endpoints are internal and authenticated via bearer token from env.
 */
@Injectable()
export class AiClientService {
  readonly aiServiceUrl: string;
  readonly authToken: string;

  constructor(private readonly configService: ConfigService) {
    this.aiServiceUrl = this.configService.getOrThrow<string>('AI_SERVICE_URL');
    this.authToken = this.configService.getOrThrow<string>('AI_SERVICE_AUTH_TOKEN');
  }

  /**
   * Extract text and face from a document image.
   * @param request - OCR request with image key and correlation ID
   * @returns OCR extraction result
   */
  async extractDocument(request: OcrRequest): Promise<OcrResult> {
    // TODO: Implement HTTP call to POST /ai/ocr
    void request;
    throw new Error('Not implemented');
  }

  /**
   * Compare faces between document and selfie.
   * @param request - Face comparison request
   * @returns Face comparison result with similarity score
   */
  async compareFaces(request: FaceCompareRequest): Promise<FaceCompareResult> {
    // TODO: Implement HTTP call to POST /ai/face-compare
    void request;
    throw new Error('Not implemented');
  }

  /**
   * Detect liveness/spoofing in a selfie image.
   * @param request - Liveness detection request
   * @returns Liveness result with score
   */
  async detectLiveness(request: LivenessRequest): Promise<LivenessResult> {
    // TODO: Implement HTTP call to POST /ai/liveness
    void request;
    throw new Error('Not implemented');
  }
}
