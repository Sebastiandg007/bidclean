import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { KycService } from './kyc.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { UploadSelfieDto } from './dto/upload-selfie.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';

/** Multer file shape from @nestjs/platform-express */
interface MulterFile {
  readonly fieldname: string;
  readonly originalname: string;
  readonly encoding: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

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
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: MulterFile,
    @Req() req: Request & { user: JwtUserPayload },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.kycService.uploadDocument(
      req.user.keycloakId,
      dto,
      file,
      idempotencyKey,
    );
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
