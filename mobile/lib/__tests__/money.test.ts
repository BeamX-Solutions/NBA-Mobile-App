import { formatNaira, groupNairaInput, parseNairaInput } from '@/lib/money';

describe('groupNairaInput', () => {
  it('groups thousands as the user types', () => {
    expect(groupNairaInput('1')).toBe('1');
    expect(groupNairaInput('123')).toBe('123');
    expect(groupNairaInput('1234')).toBe('1,234');
    expect(groupNairaInput('45000000')).toBe('45,000,000');
    expect(groupNairaInput('123456789')).toBe('123,456,789');
  });

  it('is idempotent, so re-formatting already grouped text is safe', () => {
    expect(groupNairaInput('45,000,000')).toBe('45,000,000');
    expect(groupNairaInput(groupNairaInput('45000000'))).toBe('45,000,000');
  });

  it('keeps a trailing decimal point mid-typing', () => {
    // "1,234." is a moment on the way to "1,234.50". Stripping the point would
    // delete the character the user just pressed.
    expect(groupNairaInput('1234.')).toBe('1,234.');
    expect(groupNairaInput('1234.5')).toBe('1,234.5');
    expect(groupNairaInput('1234.50')).toBe('1,234.50');
  });

  it('caps the fraction at two places and ignores later points', () => {
    expect(groupNairaInput('1234.567')).toBe('1,234.56');
    expect(groupNairaInput('1.2.3')).toBe('1.23');
  });

  it('drops anything a keyboard offers that is not part of a number', () => {
    expect(groupNairaInput('₦45,000,000.00')).toBe('45,000,000.00');
    expect(groupNairaInput('45 000 000')).toBe('45,000,000');
    expect(groupNairaInput('abc')).toBe('');
    expect(groupNairaInput('')).toBe('');
  });

  it('strips leading zeros but keeps a lone zero', () => {
    expect(groupNairaInput('007')).toBe('7');
    expect(groupNairaInput('0')).toBe('0');
    expect(groupNairaInput('0.5')).toBe('0.5');
  });

  it('produces text parseNairaInput accepts', () => {
    // The two must agree, or the field would display a figure the calculator
    // then refuses to read.
    for (const raw of ['45000000', '1234.5', '0.5', '123456789', '1234.50']) {
      const grouped = groupNairaInput(raw);
      expect(parseNairaInput(grouped)).toBe(parseNairaInput(raw));
      expect(parseNairaInput(grouped)).not.toBeNull();
    }
  });

  it('round trips through the display formatter', () => {
    const kobo = parseNairaInput(groupNairaInput('45000000'));
    expect(kobo).toBe(4_500_000_000);
    expect(formatNaira(kobo!)).toBe('₦45,000,000');
  });
});
