import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { KycService } from './kyc.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UploadSelfieDto } from './dto/upload-selfie.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * KYC controller.
 * Provides endpoints for Cleaners to upload documents, selfies,
 * check verification status, and retry failed attempts.
 */
@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(readonly kycService: KycService) {}

  /**
   * POST /kyc/document
   * Upload identity document image.
   * Requires Cleaner role.
   */
  @Post('document')
  async uploadDocument(@Body() dto: UploadDocumentDto) {
    // TODO: Extract userId from request, handle file upload via interceptor
    void dto;
    throw new Error('Not implemented');
  }

  /**
   * POST /kyc/selfie
   * Upload selfie image and enqueue processing.
   * Requires Cleaner role.
   */
  @Post('selfie')
  async uploadSelfie(@Body() dto: UploadSelfieDto) {
    // TODO: Extract userId from request, handle file upload via interceptor
    void dto;
    throw new Error('Not implemented');
  }

  /**
   * GET /kyc/status
   * Get current KYC verification status.
   * Requires Cleaner role.
   */
  @Get('status')
  async getStatus() {
    // TODO: Extract userId from request
    throw new Error('Not implemented');
  }

  /**
   * POST /kyc/retry
   * Start a new verification attempt.
   * Requires Cleaner role.
   */
  @Post('retry')
  async retry() {
    // TODO: Extract userId from request
    throw new Error('Not implemented');
  }
}
