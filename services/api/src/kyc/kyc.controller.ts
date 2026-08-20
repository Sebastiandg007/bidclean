import {
  Controller,
  Get,
  NotImplementedException,
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
import { KycStatusResponse } from './kyc.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtUserPayload } from '../auth/guards/jwt.types';

/** Multer file shape received from multipart/form-data upload */
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
  constructor(private readonly kycService: KycService) {}

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
  ): Promise<KycStatusResponse> {
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
  @UseInterceptors(FileInterceptor('file'))
  async uploadSelfie(
    @UploadedFile() file: MulterFile,
    @Req() req: Request & { user: JwtUserPayload },
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<KycStatusResponse> {
    return this.kycService.uploadSelfie(
      req.user.keycloakId,
      file,
      idempotencyKey,
    );
  }

  /**
   * GET /kyc/status
   * Get current KYC verification status.
   * Requires Cleaner role.
   */
  @Get('status')
  async getStatus(
    @Req() req: Request & { user: JwtUserPayload },
  ): Promise<KycStatusResponse> {
    return this.kycService.getStatus(req.user.keycloakId);
  }

  /**
   * POST /kyc/retry
   * Start a new verification attempt.
   * Requires Cleaner role.
   */
  @Post('retry')
  async retry(
    @Req() _req: Request & { user: JwtUserPayload },
  ): Promise<KycStatusResponse> {
    // TODO(KYC-9): Implement via kycService.retry
    throw new NotImplementedException('KYC retry endpoint not yet implemented');
  }
}
