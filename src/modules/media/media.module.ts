import { DynamicModule, Module, ModuleMetadata, Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { MediaAdminController } from './media-admin.controller';
import { MediaPublicController } from './media-public.controller';
import { MediaService } from './media.service';
import { createMediaMulterOptions } from './media-upload.config';
import { MediaAsset, MediaAssetSchema } from './schemas/media-asset.schema';
import {
  MediaStorageUsage,
  MediaStorageUsageSchema,
} from './schemas/media-storage-usage.schema';
import { LocalMediaStorageProvider } from './storage/local-media-storage.provider';
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
} from './storage/media-storage.provider';

export type MediaStorageRegistration =
  | { useClass: Type<MediaStorageProvider> }
  | { useValue: MediaStorageProvider }
  | {
      useFactory: (
        ...args: any[]
      ) => MediaStorageProvider | Promise<MediaStorageProvider>;
      inject?: any[];
    };

export interface MediaModuleOptions {
  imports?: ModuleMetadata['imports'];
  storage: MediaStorageRegistration;
}

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: MediaAsset.name, schema: MediaAssetSchema },
      { name: MediaStorageUsage.name, schema: MediaStorageUsageSchema },
    ]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createMediaMulterOptions,
    }),
  ],
  controllers: [MediaAdminController, MediaPublicController],
  providers: [
    MediaService,
    {
      provide: MEDIA_STORAGE_PROVIDER,
      useClass: LocalMediaStorageProvider,
    },
  ],
  exports: [MediaService, MEDIA_STORAGE_PROVIDER],
})
export class MediaModule {
  static register(options: MediaModuleOptions): DynamicModule {
    return {
      module: MediaModule,
      imports: options.imports,
      providers: [{ provide: MEDIA_STORAGE_PROVIDER, ...options.storage }],
      exports: [MEDIA_STORAGE_PROVIDER],
    };
  }
}
