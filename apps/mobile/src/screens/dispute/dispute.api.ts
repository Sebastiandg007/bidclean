/**
 * dispute.api — Typed HTTP access to the backend dispute-system endpoints (Spec 21).
 *
 * Uses the shared `apiClient` (lazy import to avoid circular deps), consistent with `completion.api`
 * / `checklist.api`. There is NO create call — the dispute case is created by service-completion's
 * routing consumer. Resolve/setDisputeStatus/refund/release are NOT client actions; the client only
 * supplements evidence and reconciles via `GET`.
 */

import type { AxiosInstance } from 'axios';

import { DISPUTE_ENDPOINTS } from './dispute.constants';
import type { Dispute, DisputeEvidenceKind, ResolvedEvidence, UploadTarget } from './dispute.types';

async function getApiClient(): Promise<AxiosInstance> {
  const { apiClient } = await import('../../services/api.service');
  return apiClient;
}

/** Fetch the authoritative dispute (state + phase + resolution + evidence refs + deadlines). */
export async function getDisputeRequest(id: string): Promise<Dispute> {
  const client = await getApiClient();
  const response = await client.get<Dispute>(DISPUTE_ENDPOINTS.dispute(id));
  return response.data;
}

/** Request a grant-gated pre-signed PUT target for a photo. */
export async function requestUploadRequest(id: string): Promise<UploadTarget> {
  const client = await getApiClient();
  const response = await client.post<UploadTarget>(DISPUTE_ENDPOINTS.requestUpload(id));
  return response.data;
}

/** PUT the photo bytes directly to the pre-signed MinIO URL (bytes never transit the API). */
export async function putEvidenceBytes(uploadUrl: string, body: Blob): Promise<void> {
  const client = await getApiClient();
  await client.put(uploadUrl, body, { headers: { 'Content-Type': body.type } });
}

/** Finalize an uploaded photo (server re-checks grant + window + inspects the object). */
export async function finalizeUploadRequest(id: string, objectKey: string): Promise<void> {
  const client = await getApiClient();
  await client.post(DISPUTE_ENDPOINTS.finalizeUpload(id), { objectKey });
}

/** Add a structured Host/Cleaner submission (HOST_REASON/NOTE) within the window. */
export async function addStructuredEvidenceRequest(
  id: string,
  kind: DisputeEvidenceKind,
  textValue: string,
): Promise<void> {
  const client = await getApiClient();
  await client.post(DISPUTE_ENDPOINTS.addEvidence(id), { kind, textValue });
}

/** Resolve one evidence reference to a visual URL or structured gated data. */
export async function getEvidenceUrlRequest(
  id: string,
  evidenceId: string,
): Promise<ResolvedEvidence> {
  const client = await getApiClient();
  const response = await client.get<ResolvedEvidence>(DISPUTE_ENDPOINTS.evidenceUrl(id, evidenceId));
  return response.data;
}
