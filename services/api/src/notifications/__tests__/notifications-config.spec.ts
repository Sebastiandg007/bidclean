/**
 * Unit tests for validateNotificationsConfig (Task 3.1).
 * Feature: push-notifications — config fail-fast (supports Property 12/config).
 *
 * The constants module reads env at import time and validation skips under NODE_ENV=test, so each
 * case loads the module in an isolated registry with NODE_ENV=production and a controlled env.
 */

interface ConfigCase {
  appId: string;
  apiKey: string;
  apiUrl: string;
  webhookSecret: string;
}

function runValidation(env: ConfigCase): () => void {
  let validate!: () => void;
  jest.isolateModules(() => {
    process.env.NODE_ENV = 'production';
    process.env.ONESIGNAL_APP_ID = env.appId;
    process.env.ONESIGNAL_API_KEY = env.apiKey;
    process.env.ONESIGNAL_API_URL = env.apiUrl;
    process.env.ONESIGNAL_WEBHOOK_SECRET = env.webhookSecret;
    // Leave numeric vars unset so their positive-integer defaults apply.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('NOTIFICATIONS_') || k.startsWith('ONESIGNAL_TIMEOUT') || k.startsWith('ONESIGNAL_WEBHOOK_TOL')) {
        delete process.env[k];
      }
    }
    validate = require('../notifications.constants').validateNotificationsConfig;
  });
  return validate;
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('validateNotificationsConfig', () => {
  const complete: ConfigCase = {
    appId: 'app-id',
    apiKey: 'rest-key',
    apiUrl: 'https://onesignal.com/api/v1',
    webhookSecret: 'whsec',
  };

  it('boots with a complete configuration', () => {
    expect(() => runValidation(complete)()).not.toThrow();
  });

  it('throws when ONESIGNAL_APP_ID is missing', () => {
    expect(() => runValidation({ ...complete, appId: '' })()).toThrow(/ONESIGNAL_APP_ID/);
  });

  it('throws when ONESIGNAL_API_KEY is missing', () => {
    expect(() => runValidation({ ...complete, apiKey: '' })()).toThrow(/ONESIGNAL_API_KEY/);
  });

  it('throws when ONESIGNAL_WEBHOOK_SECRET is missing', () => {
    expect(() => runValidation({ ...complete, webhookSecret: '' })()).toThrow(/ONESIGNAL_WEBHOOK_SECRET/);
  });

  it('skips validation entirely under NODE_ENV=test', () => {
    let validate!: () => void;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'test';
      process.env.ONESIGNAL_APP_ID = '';
      process.env.ONESIGNAL_API_KEY = '';
      process.env.ONESIGNAL_WEBHOOK_SECRET = '';
      validate = require('../notifications.constants').validateNotificationsConfig;
    });
    expect(() => validate()).not.toThrow();
  });
});
