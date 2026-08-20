import { Controller, Get, Post, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { KycAdminService } from './kyc-admin.service';
import { AdminDecisionDto } from '../dto/admin-decision.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/**
 * Admin KYC controller.
 * Provides endpoints for reviewing and deciding on KYC verifications.
 * All endpoints require admin-level authentication.
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
   */
  @Get(':id')
  async getVerificationDetail(@Param('id') id: string) {
    return this.kycAdminService.getVerificationDetail(id);
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
