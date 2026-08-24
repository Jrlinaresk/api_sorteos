// src/modules/locations/locations.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Country, State, City } from 'country-state-city';

@Injectable()
export class LocationsService {
  /** Lista todos los países */
  getCountries() {
    return Country.getAllCountries();
  }

  /** Lista los estados/provincias de un país dado su código ISO */
  getStates(countryCode: string) {
    return State.getStatesOfCountry(this.countryCode(countryCode));
  }

  /** Lista las ciudades de un estado dado código ISO de país y estado */
  getCities(countryCode: string, stateCode: string) {
    const country = this.countryCode(countryCode);
    const state = this.stateCode(stateCode);
    return City.getCitiesOfState(country, state).map((city) => ({
      ...city,
      /** Identificador estable para volver a consultar el detalle. */
      code: this.citySlug(city.name),
    }));
  }

  /**
   * Las ciudades de `country-state-city` no tienen código ISO propio. Se usa
   * un slug derivado del nombre y también se acepta el nombre URL-encoded para
   * conservar compatibilidad con clientes existentes.
   */
  getCity(countryCode: string, stateCode: string, cityCode: string) {
    const cities = this.getCities(countryCode, stateCode);
    const requested = cityCode.trim();
    if (!requested || requested.length > 160) {
      throw new BadRequestException('Identificador de ciudad inválido');
    }
    const requestedName = this.normalizedCityName(requested);
    const requestedSlug = this.citySlug(requested);
    const match = cities.find((city) => {
      return (
        this.normalizedCityName(city.name) === requestedName ||
        city.code === requestedSlug
      );
    });
    if (!match) {
      throw new NotFoundException(
        `Ciudad con código ${cityCode} no encontrada en ${countryCode}/${stateCode}`,
      );
    }
    return match;
  }

  private countryCode(value: string): string {
    const code = value.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new BadRequestException('Código de país inválido');
    }
    return code;
  }

  private stateCode(value: string): string {
    const code = value.trim().toUpperCase();
    if (!/^[A-Z0-9-]{1,10}$/.test(code)) {
      throw new BadRequestException('Código de estado inválido');
    }
    return code;
  }

  private normalizedCityName(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  }

  private citySlug(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
