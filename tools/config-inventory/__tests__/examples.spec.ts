/**
 * Example-based unit tests: parser sectioning/comments, classifier heuristics,
 * and requiredScope mapping, on concrete representative cases from the design.
 */

import { parseEnvExampleContent } from '../sources/env-example-parser';
import { classifyKind, classifyVariable, type MergedVariable } from '../classify';
import { extractValidatorRequiredNames } from '../sources/application-scanner';
import type { SourceType, Surface } from '../inventory.model';

function merged(
  name: string,
  surface: Surface,
  requiredByValidator: boolean,
  sourceType: SourceType = 'APPLICATION',
): MergedVariable {
  return {
    name,
    surface,
    group: 'g',
    consumedBy: ['x.ts'],
    requiredByValidator,
    provenance: [{ sourceType, sourceFile: 'x.ts', sourceLocation: 'L1' }],
    sourceTypes: new Set([sourceType]),
  };
}

describe('env-example parser — sectioning and comments', () => {
  it('extracts section headers as group and preceding comment as purpose', () => {
    const content = [
      '# --- Payments ---',
      '# Stripe secret key',
      'STRIPE_SECRET_KEY=CHANGE_ME',
      '',
      'STRIPE_API_VERSION=2024-06-20',
      '# --- Chat ---',
      'CHAT_MESSAGE_MAX_LENGTH=4000',
    ].join('\n');

    const entries = parseEnvExampleContent(content);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      name: 'STRIPE_SECRET_KEY',
      section: 'Payments',
      placeholder: 'CHANGE_ME',
      comment: 'Stripe secret key',
    });
    // A blank line resets the pending comment, so the next entry has none.
    expect(entries[1]).toMatchObject({ name: 'STRIPE_API_VERSION', section: 'Payments' });
    expect(entries[1]?.comment).toBeUndefined();
    expect(entries[2]).toMatchObject({ name: 'CHAT_MESSAGE_MAX_LENGTH', section: 'Chat' });
  });
});

describe('classifier heuristics — concrete cases', () => {
  it('classifies STRIPE_SECRET_KEY as SECRET', () => {
    expect(classifyKind('STRIPE_SECRET_KEY', 'API')).toBe('SECRET');
  });

  it('classifies EXPO_PUBLIC_RC_IOS_KEY as PUBLIC', () => {
    expect(classifyKind('EXPO_PUBLIC_RC_IOS_KEY', 'MOBILE')).toBe('PUBLIC');
  });

  it('classifies CHAT_MESSAGE_MAX_LENGTH as CONFIG', () => {
    expect(classifyKind('CHAT_MESSAGE_MAX_LENGTH', 'API')).toBe('CONFIG');
  });

  it('emits a safe placeholder for a SECRET, never a real value', () => {
    const variable = classifyVariable(merged('STRIPE_SECRET_KEY', 'API', true));
    expect(variable.placeholder).toBe('CHANGE_ME');
  });
});

describe('requiredScope mapping — concrete cases', () => {
  it('marks a validator-required var (CENTRIFUGO_TOKEN_SECRET) as runtime', () => {
    const variable = classifyVariable(merged('CENTRIFUGO_TOKEN_SECRET', 'API', true));
    expect(variable.requiredScope).toContain('runtime');
  });

  it('keeps a build-only token (BUILD source) on the build scope', () => {
    const variable = classifyVariable(merged('EXPO_PUBLIC_BUILD_TOKEN', 'MOBILE', false, 'BUILD'));
    expect(variable.requiredScope).toContain('build');
  });
});

describe('validator required-name extraction — concrete case', () => {
  it('extracts names asserted inside a validateXxxConfig body', () => {
    const content = [
      'export function validateChatConfig(): void {',
      '  const errors: string[] = [];',
      "  if (!CENTRIFUGO_TOKEN_SECRET.trim()) { errors.push('CENTRIFUGO_TOKEN_SECRET must be set'); }",
      "  const ints = [['CHAT_MESSAGE_MAX_LENGTH', CHAT_MESSAGE_MAX_LENGTH]];",
      '  if (errors.length) throw new Error(errors.join());',
      '}',
    ].join('\n');

    const required = extractValidatorRequiredNames(content);
    expect(required.has('CENTRIFUGO_TOKEN_SECRET')).toBe(true);
    expect(required.has('CHAT_MESSAGE_MAX_LENGTH')).toBe(true);
  });
});
