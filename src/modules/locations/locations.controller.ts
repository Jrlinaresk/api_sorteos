// src/modules/locations/locations.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  /**
   * GET /locations/countries
   * Retorna un array de países con { name, isoCode, ... }
   */
  @Get('countries')
  getCountries() {
    return this.locationsService.getCountries();
  }

  /**
   * GET /locations/states/:countryCode
   * Retorna un array de estados/provincias de un país
   */
  @Get('states/:countryCode')
  getStates(@Param('countryCode') countryCode: string) {
    // Convertir a mayúsculas para estandarizar
    const code = countryCode.toUpperCase();
    return this.locationsService.getStates(code);
  }

  /**
   * GET /locations/cities/:countryCode/:stateCode
   * Retorna un array de ciudades de un estado en un país
   */
  @Get('cities/:countryCode/:stateCode')
  getCities(
    @Param('countryCode') countryCode: string,
    @Param('stateCode') stateCode: string,
  ) {
    const country = countryCode.toUpperCase();
    const state = stateCode.toUpperCase();
    return this.locationsService.getCities(country, state);
  }
  /**
   * GET /locations/city/:countryCode/:stateCode/:cityCode
   * Retorna los detalles de una ciudad por el código suministrado en el listado.
   */
  @Get('city/:countryCode/:stateCode/:cityCode')
  getCity(
    @Param('countryCode') countryCode: string,
    @Param('stateCode') stateCode: string,
    @Param('cityCode') cityCode: string,
  ) {
    return this.locationsService.getCity(
      countryCode.toUpperCase(),
      stateCode.toUpperCase(),
      cityCode.toUpperCase(),
    );
  }
}
