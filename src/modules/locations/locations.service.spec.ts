import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LocationsService } from './locations.service';

describe('LocationsService city identifiers', () => {
  const service = new LocationsService();

  it('expone un código de ciudad utilizable y recupera el detalle', () => {
    const cities = service.getCities('br', 'sp');
    const saoPaulo = cities.find((city) => city.name === 'São Paulo');

    expect(saoPaulo).toMatchObject({
      countryCode: 'BR',
      stateCode: 'SP',
      code: 'sao-paulo',
    });
    expect(service.getCity('BR', 'SP', 'sao-paulo')).toEqual(saoPaulo);
    expect(service.getCity('BR', 'SP', 'São Paulo')).toEqual(saoPaulo);
  });

  it('rechaza códigos territoriales inválidos y ciudades inexistentes', () => {
    expect(() => service.getStates('../')).toThrow(BadRequestException);
    expect(() => service.getCities('BR', '../SP')).toThrow(BadRequestException);
    expect(() => service.getCity('BR', 'SP', 'ciudad-inexistente')).toThrow(
      NotFoundException,
    );
  });
});
