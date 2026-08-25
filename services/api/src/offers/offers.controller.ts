import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { OffersService } from './offers.service';

/**
 * Offers controller.
 *
 * Exposes REST endpoints for the offer lifecycle:
 * - POST /offers — create a new offer (DRAFT)
 * - POST /offers/:id/publish — publish an offer (DRAFT → PUBLISHED)
 * - POST /offers/:id/cancel — cancel an offer
 * - GET /offers — list own offers (paginated, filterable by state)
 * - GET /offers/:id — get offer detail with state history
 * - GET /offers/:id/price-breakdown — get price breakdown (Host or Cleaner view)
 */
@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {
    void this.offersService;
  }

  /**
   * Create a new offer in DRAFT state.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(): Promise<unknown> {
    // TODO: Implement in Task 24
    return {};
  }

  /**
   * Publish an offer (DRAFT → PUBLISHED).
   * Triggers radius expansion scheduling and initial delivery.
   */
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(@Param('id') _id: string): Promise<unknown> {
    // TODO: Implement in Task 24
    return {};
  }

  /**
   * Cancel an offer (DRAFT/PUBLISHED/ACTIVE → CANCELLED).
   * Cancels pending BullMQ jobs and notifies delivered Cleaners.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') _id: string): Promise<unknown> {
    // TODO: Implement in Task 24
    return {};
  }

  /**
   * List own offers with pagination and state filtering.
   */
  @Get()
  async findAll(): Promise<unknown> {
    // TODO: Implement in Task 24
    return {};
  }

  /**
   * Get offer detail with state transition history.
   */
  @Get(':id')
  async findOne(@Param('id') _id: string): Promise<unknown> {
    // TODO: Implement in Task 24
    return {};
  }

  /**
   * Get price breakdown for an offer (Host or Cleaner view).
   */
  @Get(':id/price-breakdown')
  async getPriceBreakdown(@Param('id') _id: string): Promise<unknown> {
    // TODO: Implement in Task 24
    return {};
  }
}
