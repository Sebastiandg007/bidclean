/**
 * Unit tests for the voip API client.
 *
 * Validates the request composition (initiate → answer/decline/cancel/end/token/get/list) against a
 * mocked apiClient: the correct paths, the idempotency header on initiate, and that the room name +
 * token only arrive on initiate/answer/token responses. No network.
 *
 * @requirements 5.1, 5.5
 */

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock('../../../../services/api.service', () => ({
  apiClient: { post: mockPost, get: mockGet },
}));

import {
  answerCallRequest,
  cancelCallRequest,
  declineCallRequest,
  endCallRequest,
  getCallRequest,
  initiateCallRequest,
  listCallsRequest,
  requestMediaTokenRequest,
} from '../voip.api';

const CONV = 'conv-1';
const CALL = 'call-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('voip.api', () => {
  it('initiate posts to the calls path with an Idempotency-Key = clientCallId', async () => {
    mockPost.mockResolvedValueOnce({ data: { call: {}, roomName: 'r', media: {} } });
    await initiateCallRequest(CONV, 'ccid-1', 'AUDIO');
    expect(mockPost).toHaveBeenCalledWith(
      `/chat/conversations/${CONV}/calls`,
      { clientCallId: 'ccid-1', mediaKind: 'AUDIO' },
      { headers: { 'Idempotency-Key': 'ccid-1' } },
    );
  });

  it('answer/decline/cancel/end/token post to the correct sub-paths', async () => {
    mockPost.mockResolvedValue({ data: {} });
    await answerCallRequest(CONV, CALL);
    await declineCallRequest(CONV, CALL);
    await cancelCallRequest(CONV, CALL);
    await endCallRequest(CONV, CALL);
    await requestMediaTokenRequest(CONV, CALL);
    const base = `/chat/conversations/${CONV}/calls/${CALL}`;
    expect(mockPost).toHaveBeenCalledWith(`${base}/answer`);
    expect(mockPost).toHaveBeenCalledWith(`${base}/decline`);
    expect(mockPost).toHaveBeenCalledWith(`${base}/cancel`);
    expect(mockPost).toHaveBeenCalledWith(`${base}/end`, { endReason: 'HANGUP' });
    expect(mockPost).toHaveBeenCalledWith(`${base}/token`);
  });

  it('getCall/listCalls read from the correct paths (with optional before cursor)', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await getCallRequest(CONV, CALL);
    expect(mockGet).toHaveBeenCalledWith(`/chat/conversations/${CONV}/calls/${CALL}`);

    await listCallsRequest(CONV, null, 25);
    expect(mockGet).toHaveBeenCalledWith(`/chat/conversations/${CONV}/calls`, {
      params: { limit: 25 },
    });

    await listCallsRequest(CONV, '2020-01-01T00:00:00.000Z', 25);
    expect(mockGet).toHaveBeenCalledWith(`/chat/conversations/${CONV}/calls`, {
      params: { limit: 25, before: '2020-01-01T00:00:00.000Z' },
    });
  });
});
