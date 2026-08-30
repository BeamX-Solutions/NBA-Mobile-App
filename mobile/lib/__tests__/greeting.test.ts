import { firstNameOf, greetingFor } from '@/lib/names';

describe('firstNameOf', () => {
  it('takes the first word of a plain name', () => {
    expect(firstNameOf('Chimaobi Ibeh')).toBe('Chimaobi');
  });

  it('skips a legal honorific, since names are registered as on the Call to Bar certificate', () => {
    expect(firstNameOf('Barr. Oluwaseun Adebayo')).toBe('Oluwaseun');
    expect(firstNameOf('Chief Adesuwa Opeyemi')).toBe('Adesuwa');
    expect(firstNameOf('Dr Alistair Vance')).toBe('Alistair');
  });

  it('skips honorifics regardless of case or trailing full stop', () => {
    expect(firstNameOf('BARR Ngozi Eze')).toBe('Ngozi');
    expect(firstNameOf('mrs. Amaka Obi')).toBe('Amaka');
  });

  it('collapses irregular spacing', () => {
    expect(firstNameOf('  Barr.   Emeka   Nwosu ')).toBe('Emeka');
  });

  it('returns null when there is no usable name, so the caller can fall back', () => {
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf('   ')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });

  it('returns null rather than the title when the name is only an honorific', () => {
    expect(firstNameOf('Barr.')).toBeNull();
  });
});

describe('greetingFor', () => {
  it('covers the boundaries of each period', () => {
    expect(greetingFor(0)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(16)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good evening');
    expect(greetingFor(23)).toBe('Good evening');
  });
});
