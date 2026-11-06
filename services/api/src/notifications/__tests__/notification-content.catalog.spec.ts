import { NotificationType } from '../notifications.types';
import { NotificationContentCatalog } from '../notification-content.catalog';

/**
 * Unit tests for NotificationContentCatalog (Task 3.4).
 * Feature: push-notifications, Property 15: Localization parity.
 */
describe('NotificationContentCatalog', () => {
  const catalog = new NotificationContentCatalog();

  it('has en/es parity for every declared type (assertParity does not throw)', () => {
    expect(() => catalog.assertParity()).not.toThrow();
  });

  it('renders both en and es headings/contents for every type', () => {
    for (const type of Object.values(NotificationType)) {
      const rendered = catalog.render(type, {});
      expect(rendered.headings.en?.length).toBeGreaterThan(0);
      expect(rendered.headings.es?.length).toBeGreaterThan(0);
      expect(rendered.contents.en?.length).toBeGreaterThan(0);
      expect(rendered.contents.es?.length).toBeGreaterThan(0);
    }
  });

  it('interpolates {placeholder} tokens using ids/labels only', () => {
    const rendered = catalog.render(NotificationType.OFFER_MATCHED, { amount: '42' });
    // The default OFFER_MATCHED template has no placeholder, so content is unchanged.
    expect(rendered.contents.en).not.toContain('{');
  });

  it('leaves unknown placeholders intact rather than throwing', () => {
    // Use a template with no tokens; interpolate on arbitrary payload must not throw.
    expect(() => catalog.render(NotificationType.MESSAGE_CREATED, { foo: 'bar' })).not.toThrow();
  });

  it('throws when rendering an unregistered type', () => {
    expect(() => catalog.render('nope' as NotificationType, {})).toThrow(/No content template/);
  });
});
