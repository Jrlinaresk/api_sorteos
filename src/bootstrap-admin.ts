import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BootstrapAdminModule } from './bootstrap/bootstrap-admin.module';
import { FirstAdminBootstrapService } from './bootstrap/first-admin-bootstrap.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(BootstrapAdminModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(FirstAdminBootstrapService).run();
    process.stdout.write(
      result.created
        ? `Administrador inicial creado: ${result.userId}\n`
        : `Inicialización ya completada: ${result.userId}\n`,
    );
  } finally {
    await app.close();
  }
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`No se pudo inicializar el administrador: ${message}\n`);
  process.exitCode = 1;
});
