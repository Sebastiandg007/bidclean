import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiClientService } from '../ai-client/ai-client.service';
import {
  AiServiceHttpError,
  AiServiceNetworkError,
  AiServiceTimeoutError,
} from '../ai-client/ai-client.errors';

/**
 * Mock axios instance methods.
 */
const mockPost = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({
      post: mockPost,
    })),
  },
}));

describe('AiClientService', () => {
  let service: AiClientService;

  const mockConfigValues: Record<string, string> = {
    KYC_AI_SERVICE_URL: 'http://localhost:8000',
    AI_SERVICE_AUTH_TOKEN: 'test-auth-token',
    KYC_PROCESSING_TIMEOUT_MS: '60000',
    KYC_PROCESSING_MAX_RETRIES: '2',
    KYC_PROCESSING_BACKOFF_MS: '100',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiClientService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const value = mockConfigValues[key];
              if (!value) throw new Error(`Config key "${key}" not found`);
              return value;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AiClientService>(AiClientService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('extractDocument', () => {
    it('should call POST /ai/ocr and return OCR result', async () => {
      const mockResult = {
        extractedName: 'John Doe',
        extractedDocumentNumber: 'AB123456',
        extractedExpiryDate: '2030-01-01',
        extractedDocumentType: 'PASSPORT',
        faceDetected: true,
        confidence: 0.95,
      };
      mockPost.mockResolvedValue({ data: mockResult });

      const result = await service.extractDocument({
        imageKey: 'kyc/user-1/document/img.jpg',
        correlationId: 'corr-123',
      });

      expect(result).toEqual(mockResult);
      expect(mockPost).toHaveBeenCalledWith(
        '/ai/ocr',
        { imageKey: 'kyc/user-1/document/img.jpg' },
        { headers: { 'X-Request-ID': 'corr-123' } },
      );
    });
  });

  describe('compareFaces', () => {
    it('should call POST /ai/face-compare and return comparison result', async () => {
      const mockResult = { similarityScore: 0.92, isMatch: true };
      mockPost.mockResolvedValue({ data: mockResult });

      const result = await service.compareFaces({
        documentImageKey: 'kyc/user-1/document/img.jpg',
        selfieImageKey: 'kyc/user-1/selfie/img.jpg',
        correlationId: 'corr-456',
      });

      expect(result).toEqual(mockResult);
      expect(mockPost).toHaveBeenCalledWith(
        '/ai/face-compare',
        {
          documentImageKey: 'kyc/user-1/document/img.jpg',
          selfieImageKey: 'kyc/user-1/selfie/img.jpg',
        },
        { headers: { 'X-Request-ID': 'corr-456' } },
      );
    });
  });

  describe('detectLiveness', () => {
    it('should call POST /ai/liveness and return liveness result', async () => {
      const mockResult = { livenessScore: 0.97, isLive: true };
      mockPost.mockResolvedValue({ data: mockResult });

      const result = await service.detectLiveness({
        selfieImageKey: 'kyc/user-1/selfie/img.jpg',
        correlationId: 'corr-789',
      });

      expect(result).toEqual(mockResult);
      expect(mockPost).toHaveBeenCalledWith(
        '/ai/liveness',
        { selfieImageKey: 'kyc/user-1/selfie/img.jpg' },
        { headers: { 'X-Request-ID': 'corr-789' } },
      );
    });
  });

  describe('authorization and headers', () => {
    it('should create axios instance with correct auth header and base URL', async () => {
      const axiosModule = jest.requireMock('axios');
      expect(axiosModule.default.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:8000',
        timeout: 60000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-auth-token',
        },
      });
    });

    it('should send X-Request-ID header with the correlation ID', async () => {
      mockPost.mockResolvedValue({ data: { livenessScore: 0.9, isLive: true } });

      await service.detectLiveness({
        selfieImageKey: 'key',
        correlationId: 'unique-correlation-id',
      });

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        { headers: { 'X-Request-ID': 'unique-correlation-id' } },
      );
    });
  });

  describe('retry on 5xx errors', () => {
    it('should retry on 500 and succeed on second attempt', async () => {
      jest.useRealTimers();
      const axiosError = createAxiosError(500, { code: 'INTERNAL', message: 'Server error' });
      const successResult = { livenessScore: 0.95, isLive: true };

      mockPost
        .mockRejectedValueOnce(axiosError)
        .mockResolvedValueOnce({ data: successResult });

      const result = await service.detectLiveness({
        selfieImageKey: 'key',
        correlationId: 'corr-retry',
      });

      expect(result).toEqual(successResult);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting all retries on persistent 5xx', async () => {
      jest.useRealTimers();
      const axiosError = createAxiosError(503, { code: 'UNAVAILABLE', message: 'Service down' });
      mockPost.mockRejectedValue(axiosError);

      await expect(
        service.extractDocument({ imageKey: 'key', correlationId: 'corr-exhaust' }),
      ).rejects.toBeInstanceOf(AiServiceHttpError);

      // Initial attempt + 2 retries = 3 total calls
      expect(mockPost).toHaveBeenCalledTimes(3);
    });
  });

  describe('no retry on 4xx errors', () => {
    it('should not retry on 400 Bad Request', async () => {
      const axiosError = createAxiosError(400, { code: 'BAD_REQUEST', message: 'Invalid image' });
      mockPost.mockRejectedValue(axiosError);

      await expect(
        service.extractDocument({ imageKey: 'bad-key', correlationId: 'corr-400' }),
      ).rejects.toBeInstanceOf(AiServiceHttpError);

      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 422 Unprocessable Entity', async () => {
      const axiosError = createAxiosError(422, { code: 'OCR_FAILED', message: 'Cannot read document' });
      mockPost.mockRejectedValue(axiosError);

      try {
        await service.extractDocument({ imageKey: 'unreadable', correlationId: 'corr-422' });
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AiServiceHttpError);
        const httpError = error as AiServiceHttpError;
        expect(httpError.statusCode).toBe(422);
        expect(httpError.errorCode).toBe('OCR_FAILED');
        expect(httpError.isRetryable).toBe(false);
      }

      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout handling', () => {
    it('should throw AiServiceTimeoutError on ECONNABORTED', async () => {
      jest.useRealTimers();
      const axiosError = createTimeoutError('ECONNABORTED');
      mockPost.mockRejectedValue(axiosError);

      await expect(
        service.compareFaces({
          documentImageKey: 'doc',
          selfieImageKey: 'selfie',
          correlationId: 'corr-timeout',
        }),
      ).rejects.toBeInstanceOf(AiServiceTimeoutError);
    });

    it('should retry on timeout (transient failure)', async () => {
      jest.useRealTimers();
      const timeoutError = createTimeoutError('ECONNABORTED');
      const successResult = { similarityScore: 0.88, isMatch: true };

      mockPost
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ data: successResult });

      const result = await service.compareFaces({
        documentImageKey: 'doc',
        selfieImageKey: 'selfie',
        correlationId: 'corr-timeout-retry',
      });

      expect(result).toEqual(successResult);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  describe('network error handling', () => {
    it('should throw AiServiceNetworkError on connection refused', async () => {
      jest.useRealTimers();
      const networkError = createNetworkError('connect ECONNREFUSED 127.0.0.1:8000');
      mockPost.mockRejectedValue(networkError);

      await expect(
        service.detectLiveness({ selfieImageKey: 'key', correlationId: 'corr-network' }),
      ).rejects.toBeInstanceOf(AiServiceNetworkError);
    });

    it('should retry on network errors (transient failure)', async () => {
      jest.useRealTimers();
      const networkError = createNetworkError('ECONNREFUSED');
      const successResult = { livenessScore: 0.91, isLive: true };

      mockPost
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ data: successResult });

      const result = await service.detectLiveness({
        selfieImageKey: 'key',
        correlationId: 'corr-net-retry',
      });

      expect(result).toEqual(successResult);
      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });
});

/** Helper: create a mock AxiosError with an HTTP response */
function createAxiosError(
  status: number,
  data: { code: string; message: string },
): Partial<import('axios').AxiosError> {
  return {
    isAxiosError: true,
    response: { status, data, headers: {}, statusText: '', config: {} as never },
    code: undefined,
    message: `Request failed with status code ${status}`,
  } as unknown as import('axios').AxiosError;
}

/** Helper: create a mock AxiosError for timeout */
function createTimeoutError(code: string): Partial<import('axios').AxiosError> {
  return {
    isAxiosError: true,
    code,
    response: undefined,
    message: 'timeout of 60000ms exceeded',
  } as unknown as import('axios').AxiosError;
}

/** Helper: create a mock AxiosError for network failure */
function createNetworkError(message: string): Partial<import('axios').AxiosError> {
  return {
    isAxiosError: true,
    code: 'ECONNREFUSED',
    response: undefined,
    message,
  } as unknown as import('axios').AxiosError;
}
