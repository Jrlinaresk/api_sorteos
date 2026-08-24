import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  @Get(['', 'ready'])
  async check() {
    if (this.connection.readyState !== 1 || !this.connection.db) {
      throw new ServiceUnavailableException('Base de datos no disponible');
    }
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.connection.db.admin().command({ ping: 1 }),
        new Promise(
          (_, reject) =>
            (timeout = setTimeout(() => reject(new Error('timeout')), 2_000)),
        ),
      ]);
    } catch {
      throw new ServiceUnavailableException('Base de datos no disponible');
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return { ...this.live(), dependencies: { mongodb: 'ok' } };
  }
}
