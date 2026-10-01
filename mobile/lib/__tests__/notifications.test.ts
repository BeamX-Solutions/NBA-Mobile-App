import { mobileRouteFor, parseNotification, relativeTime, unreadBadge } from '@/lib/notifications';

const now = new Date('2026-10-01T12:00:00Z');
const txnId = '96e8931a-3578-46b0-8109-620f2f1baefd';
const row = {
  id: 'b18c2bad-bfcb-40d5-b7d0-1c6ea836a3d6',
  user_id: '29000000-0000-4000-8000-0000000000a1',
  kind: 'payment_rejected',
  title: 'Payment proof rejected',
  body: 'INV-0001: Amount does not match.',
  link: `/transactions/${txnId}`,
  created_at: '2026-10-01T11:55:00Z',
  read_at: null,
};

describe('mobileRouteFor', () => {
  it('maps the web paths the triggers write to routes in this app', () => {
    expect(mobileRouteFor('/')).toBe('/(tabs)');
    expect(mobileRouteFor('/membership')).toBe('/(tabs)');
    expect(mobileRouteFor('/profile/edit')).toBe('/profile/edit');
    expect(mobileRouteFor(`/transactions/${txnId}`)).toEqual({
      pathname: '/transaction/[id]',
      params: { id: txnId },
    });
    expect(mobileRouteFor(`/certificates/${txnId}`)).toEqual({
      pathname: '/certificate/[id]',
      params: { id: txnId },
    });
  });

  it('leads nowhere for anything it does not recognise', () => {
    for (const link of [
      null,
      undefined,
      '',
      '/transactions/not-a-uuid',
      `/transactions/${txnId}/invoice`,
      `/transactions/${txnId}?x=1`,
      'https://evil.example/transactions/x',
      '//evil.example',
      '/settings/security',
    ]) {
      expect(mobileRouteFor(link)).toBeNull();
    }
  });
});

describe('parseNotification', () => {
  it('turns a stored row into an unread inbox entry', () => {
    expect(parseNotification(row, now)).toEqual({
      id: row.id,
      kind: 'payment_rejected',
      title: 'Payment proof rejected',
      body: 'INV-0001: Amount does not match.',
      route: { pathname: '/transaction/[id]', params: { id: txnId } },
      when: '5 min ago',
      read: false,
    });
    expect(parseNotification({ ...row, read_at: '2026-10-01T11:56:00Z' }, now)?.read).toBe(true);
  });

  it('drops malformed rows rather than showing them', () => {
    for (const value of [
      null,
      [],
      { ...row, id: '1' },
      { ...row, kind: 'forged' },
      { ...row, title: ' ' },
      { ...row, body: null },
      { ...row, created_at: 'bad' },
      { ...row, read_at: 5 },
    ]) {
      expect(parseNotification(value, now)).toBeNull();
    }
  });
});

describe('relativeTime', () => {
  it('reads the way people say it', () => {
    expect(relativeTime(new Date('2026-10-01T11:59:30Z'), now)).toBe('Just now');
    expect(relativeTime(new Date('2026-10-01T09:00:00Z'), now)).toBe('3 h ago');
    expect(relativeTime(new Date('2026-09-30T10:00:00Z'), now)).toBe('Yesterday');
    expect(relativeTime(new Date('2026-09-04T10:00:00Z'), now)).toBe('4 September 2026');
  });
});

describe('unreadBadge', () => {
  it('caps at 9+ and hides at zero', () => {
    expect(unreadBadge(0)).toBe('');
    expect(unreadBadge(3)).toBe('3');
    expect(unreadBadge(12)).toBe('9+');
  });
});
