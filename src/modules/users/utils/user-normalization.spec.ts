import {
  normalizeCpf,
  normalizeEmail,
  normalizeHumanName,
  normalizePhone,
  phoneLookupCandidates,
} from './user-normalization';

describe('user normalization', () => {
  it('normaliza teléfonos brasileños nacionales e internacionales', () => {
    expect(normalizePhone('(11) 99999-9999')).toBe('+5511999999999');
    expect(normalizePhone('+55 (11) 99999-9999')).toBe('+5511999999999');
  });

  it('conserva candidatos heredados para el login', () => {
    expect(phoneLookupCandidates('(11) 99999-9999')).toEqual(
      expect.arrayContaining(['11999999999', '+5511999999999']),
    );
  });

  it('normaliza los datos personales', () => {
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeEmail('  USER@Example.COM ')).toBe('user@example.com');
    expect(normalizeHumanName('  João   da Silva ')).toBe('João da Silva');
  });
});
