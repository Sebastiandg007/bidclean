/**
 * Unit tests for negotiation config validation (fail-fast at startup).
 *
 * Feature: offer-negotiation
 * Validates that out-of-range configuration throws, and defaults are valid.
 * Uses jest.isolateModules + env overrides so each case loads a fresh module.
 */
describe('validateNegotiationConfig', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  function loadWithEnv(overrides: Record<string, string>): () => void {
    let validate: () => void = () => undefined;
    jest.isolateModules(() => {
      process.env = { ...ORIGINAL_ENV, ...overrides };
      const mod = require('../negotiation.constants') as {
        validateNegotiationConfig: () => void;
      };
      validate = mod.validateNegotiationConfig;
    });
    return validate;
  }

  it('accepts the default configuration', () => {
    const validate = loadWithEnv({});
    expect(() => validate()).not.toThrow();
  });

  it('rejects a deviation bps above 10000', () => {
    const validate = loadWithEnv({ NEGOTIATION_MAX_DEVIATION_BPS: '15000' });
    expect(() => validate()).toThrow(/NEGOTIATION_MAX_DEVIATION_BPS/);
  });

  it('rejects a non-positive response window', () => {
    const validate = loadWithEnv({ NEGOTIATION_RESPONSE_WINDOW_MS: '0' });
    expect(() => validate()).toThrow(/NEGOTIATION_RESPONSE_WINDOW_MS/);
  });

  it('rejects a non-positive max proposals', () => {
    const validate = loadWithEnv({ NEGOTIATION_MAX_PROPOSALS: '0' });
    expect(() => validate()).toThrow(/NEGOTIATION_MAX_PROPOSALS_PER_THREAD/);
  });
});
