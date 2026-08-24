import { isValidCpf } from './is-cpf.validator';

describe('isValidCpf', () => {
  it('acepta un CPF con dígitos verificadores correctos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });

  it('rechaza CPF repetidos o con verificador incorrecto', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('529.982.247-24')).toBe(false);
  });
});
