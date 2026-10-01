import { NotificationType } from '../notifications.types';
import { NotificationTypeRegistry } from '../notification-type.registry';

/**
 * Unit tests for NotificationTypeRegistry (Task 3.3).
 * Feature: push-notifications — supports Property 8 (metadata-driven suppression, calls exempt).
 */
describe('NotificationTypeRegistry', () => {
  const registry = new NotificationTypeRegistry();

  it('returns metadata for every declared NotificationType', () => {
    for (const type of Object.values(NotificationType)) {
      expect(registry.has(type)).toBe(true);
      const meta = registry.get(type);
      expect(meta.priority).toMatch(/^(HIGH|NORMAL|LOW)$/);
      expect(meta.quietHoursBehavior).toMatch(/^(RESPECT|EXEMPT)$/);
      expect(typeof meta.defaultEnabled).toBe('boolean');
    }
  });

  it('marks call-invited as HIGH priority and EXEMPT from quiet hours', () => {
    const meta = registry.get(NotificationType.CALL_INVITED);
    expect(meta.priority).toBe('HIGH');
    expect(meta.quietHoursBehavior).toBe('EXEMPT');
  });

  it('throws for an unregistered type', () => {
    expect(() => registry.get('does-not-exist' as NotificationType)).toThrow(/No NotificationType metadata/);
  });
});
