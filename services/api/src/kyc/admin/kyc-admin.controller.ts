import { Controller, Get, Post, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { KycAdminService } from './kyc-admin.service';
import { AdminDecisionDto } from '../dto/admin-decision.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/**
 * Admin KYC controller.
 * Provides endpoints for reviewing and deciding on KYC verifications.
 * All endpoints require admin-level authentication.
 * Data access is logged for GDPR compliance.
 */
@Controller('admin/kyc')
@UseGuards(JwtAuthGuard)
export class KycAdminController {
  constructor(private readonly kycAdminService: KycAdminService) {}

  /**
   * GET /admin/kyc/queue
   * Get pending verifications for admin review.
   */
  @Get('queue')
  async getQueue(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.kycAdminService.getReviewQueue(
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /**
   * GET /admin/kyc/:id
   * Get full verification details for admin review.
   * Logs OCR_VIEWED for GDPR compliance.
   */
  @Get(':id')
  async getVerificationDetail(
    @Param('id') id: string,
    @Request() req: { user: { sub: string } },
  ) {
    return this.kycAdminService.getVerificationDetail(id, req.user.sub);
  }

  /**
   * GET /admin/kyc/:id/document
   * Serve document image to admin.
   * Logs DOCUMENT_VIEWED for GDPR compliance.
   */
  @Get(':id/document')
  async getDocumentImage(
    @Param('id') id: string,
    @Request() req: { user: { sub: string } },
  ) {
    return this.kycAdminService.getDocumentImage(id, req.user.sub);
  }

  /**
   * GET /admin/kyc/:id/selfie
   * Serve selfie image to admin.
   * Logs SELFIE_VIEWED for GDPR compliance.
   */
  @Get(':id/selfie')
  async getSelfieImage(
    @Param('id') id: string,
    @Request() req: { user: { sub: string } },
  ) {
    return this.kycAdminService.getSelfieImage(id, req.user.sub);
  }

  /**
   * POST /admin/kyc/:id/decision
   * Approve or reject a verification.
   */
  @Post(':id/decision')
  async makeDecision(
    @Param('id') id: string,
    @Body() dto: AdminDecisionDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.kycAdminService.makeDecision(id, dto, req.user.sub);
  }
}
