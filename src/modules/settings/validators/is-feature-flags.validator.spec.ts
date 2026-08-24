import { isFeatureFlags } from './is-feature-flags.validator';

describe('isFeatureFlags', () => {
  it('acepta únicamente mapas booleanos con claves seguras', () => {
    expect(isFeatureFlags({ notifications: true, 'quiz.pwa': false })).toBe(
      true,
    );
    expect(isFeatureFlags({ notifications: 'yes' })).toBe(false);
    expect(isFeatureFlags({ '<script>': true })).toBe(false);
    expect(isFeatureFlags([])).toBe(false);
  });
});
