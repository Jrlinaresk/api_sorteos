import { existsSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import { configureAdminPanel } from './admin-panel.config';

jest.mock('node:fs', () => ({
  ...jest.requireActual<typeof import('node:fs')>('node:fs'),
  existsSync: jest.fn(),
}));

describe('configureAdminPanel', () => {
  const mockedExistsSync = jest.mocked(existsSync);

  function context(values: Record<string, string>) {
    const express = {
      use: jest.fn(),
      get: jest.fn(),
    } as unknown as Express;
    const config = {
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;
    const logger = { log: jest.fn(), warn: jest.fn() };
    return { express, config, logger };
  }

  beforeEach(() => mockedExistsSync.mockReset());

  it('aborta producción cuando falta el artefacto administrativo', () => {
    mockedExistsSync.mockReturnValue(false);
    const { express, config, logger } = context({
      NODE_ENV: 'production',
      ADMIN_PANEL_ENABLED: 'true',
    });

    expect(() => configureAdminPanel(express, config, logger)).toThrow(
      'No se encontró dist/admin/index.html',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('solo advierte en desarrollo cuando el bundle aún no existe', () => {
    mockedExistsSync.mockReturnValue(false);
    const { express, config, logger } = context({
      NODE_ENV: 'development',
      ADMIN_PANEL_ENABLED: 'true',
    });

    expect(configureAdminPanel(express, config, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('pnpm build:admin'),
    );
  });

  it('permite deshabilitar la interfaz sin exigir sus archivos', () => {
    const { express, config, logger } = context({
      NODE_ENV: 'production',
      ADMIN_PANEL_ENABLED: 'false',
    });

    expect(configureAdminPanel(express, config, logger)).toBe(false);
    expect(mockedExistsSync).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      'Panel administrativo deshabilitado por configuración',
    );
  });
});
