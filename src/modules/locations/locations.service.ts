// src/modules/locations/locations.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Country, State, City } from 'country-state-city';

@Injectable()
export class LocationsService {
  /** Lista todos los países */
  getCountries() {
    return Country.getAllCountries();
  }

  /** Lista los estados/provincias de un país dado su código ISO */
  getStates(countryCode: string) {
    return State.getStatesOfCountry(countryCode);
  }

  /** Lista las ciudades de un estado dado código ISO de país y estado */
  getCities(countryCode: string, stateCode: string) {
    return City.getCitiesOfState(countryCode, stateCode);
  }

  /**
   * Retorna datos de una ciudad específica mediante su código ISO.
   */
  getCity(countryCode: string, stateCode: string, cityCode: string) {
    const cities = this.getCities(countryCode, stateCode);
    const match = cities.find(
      (c: any) => c.isoCode.toUpperCase() === cityCode.toUpperCase(),
    );
    if (!match) {
      throw new NotFoundException(
        `Ciudad con código ${cityCode} no encontrada en ${countryCode}/${stateCode}`,
      );
    }
    return match;
  }
}
