import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import {
  STRIPE_API_VERSION,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
} from '../payments.constants';

/**
 * Thin, injectable wrapper around the Stripe SDK — the module's ONLY seam to Stripe.
 *
 * No other file imports `stripe` directly, so unit and property tests mock this client.
 * Every mutating method forwards an idempotency key; `constructWebhookEvent` verifies
 * the signature within the configured tolerance window (rejecting old/invalid events).
 */
@Injectable()
export class StripeClient {
  private readonly stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    });
  }

  /** Create an Express Connected Account for a Cleaner. */
  createConnectedAccount(params: Stripe.AccountCreateParams): Promise<Stripe.Account> {
    return this.stripe.accounts.create(params);
  }

  /** Create an onboarding Account Link (hosted onboarding URL). */
  createAccountLink(params: Stripe.AccountLinkCreateParams): Promise<Stripe.AccountLink> {
    return this.stripe.accountLinks.create(params);
  }

  /** Retrieve a Connected Account (used by account reconciliation). */
  retrieveAccount(accountId: string): Promise<Stripe.Account> {
    return this.stripe.accounts.retrieve(accountId);
  }

  /** Create a PaymentIntent (charge the Host) with an idempotency key. */
  createPaymentIntent(
    params: Stripe.PaymentIntentCreateParams,
    idempotencyKey: string,
  ): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.create(params, { idempotencyKey });
  }

  /** Retrieve a PaymentIntent (reconciliation), expanding the latest charge. */
  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.retrieve(id, {
      expand: ['latest_charge.balance_transaction'],
    });
  }

  /** Create a Transfer to a Connected Account (payout) with an idempotency key. */
  createTransfer(
    params: Stripe.TransferCreateParams,
    idempotencyKey: string,
  ): Promise<Stripe.Transfer> {
    return this.stripe.transfers.create(params, { idempotencyKey });
  }

  /** Reverse a Transfer (post-release refund) with an idempotency key. */
  createTransferReversal(
    transferId: string,
    params: Stripe.TransferReversalCreateParams,
    idempotencyKey: string,
  ): Promise<Stripe.TransferReversal> {
    return this.stripe.transfers.createReversal(transferId, params, { idempotencyKey });
  }

  /** Create a Refund to the Host with an idempotency key. */
  createRefund(
    params: Stripe.RefundCreateParams,
    idempotencyKey: string,
  ): Promise<Stripe.Refund> {
    return this.stripe.refunds.create(params, { idempotencyKey });
  }

  /**
   * Verify a webhook signature and construct the event, rejecting events older than
   * the configured tolerance window (replay guard, Property P9). Throws on invalid or
   * expired signatures.
   */
  constructWebhookEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET,
      STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    );
  }
}
