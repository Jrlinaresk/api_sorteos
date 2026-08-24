import { Allow } from 'class-validator';

/**
 * El resultado Federal se deriva por completo del contrato de campaña y de
 * CAIXA. No admite números ni premios introducidos durante la verificación.
 */
export class VerifyFederalDrawDto {
  /** Metadato interno para que class-validator trate el DTO vacío como conocido. */
  @Allow()
  private readonly _validationMarker?: never;
}
