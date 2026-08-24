import { ConfigService } from '@nestjs/config';

export function mongoUri(config: ConfigService): string {
  const configured = config.get<string>('MONGODB_URI')?.trim();
  if (configured) return configured;

  const host = config.get<string>('DB_HOST') || '127.0.0.1';
  const port = config.get<string>('DB_PORT') || '27017';
  const database = config.get<string>('DB_NAME') || 'api_sorteos';
  const user = config.get<string>('DB_USER');
  const password = config.get<string>('DB_PASSWORD');
  const credentials = user
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password || '')}@`
    : '';
  const query = new URLSearchParams();
  if (user) {
    query.set('authSource', config.get<string>('DB_AUTH_SOURCE') || 'admin');
  }
  const replicaSet = config.get<string>('MONGODB_REPLICA_SET');
  if (replicaSet) {
    query.set('replicaSet', replicaSet);
    query.set('retryWrites', 'true');
    query.set('w', 'majority');
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return `mongodb://${credentials}${host}:${port}/${database}${suffix}`;
}

export function mongoConnectionOptions(config: ConfigService) {
  return {
    uri: mongoUri(config),
    maxPoolSize: Number(config.get<string>('MONGODB_MAX_POOL_SIZE') || 20),
    serverSelectionTimeoutMS: 10_000,
    autoIndex: config.get<string>('MONGODB_AUTO_INDEX') !== 'false',
  };
}
