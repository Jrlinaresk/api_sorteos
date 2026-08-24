# Media: almacenamiento seguro e integración

## Endpoints

- `POST /admin/media`: `multipart/form-data`, campo `file`. Requiere JWT y rol `operator` o `admin`.
- `DELETE /admin/media/:mediaId`: requiere JWT y rol `admin`. Es un soft delete y sólo funciona si `references` está vacío.
- `GET /media/:mediaId`: público. Entrega únicamente assets activos con `Content-Type`, `Content-Length`, `ETag`, cache y `X-Content-Type-Options: nosniff`.

Sólo se aceptan JPEG, PNG, WebP, MP4 y WebM. Se comprueban tanto el MIME como los magic bytes. SVG, HTML y cualquier payload base64 están fuera del contrato. El nombre del cliente nunca se usa como ruta; los objetos reciben nombres criptográficos.

## Configuración local

| Variable                | Predeterminado        | Uso                           |
| ----------------------- | --------------------- | ----------------------------- |
| `MEDIA_LOCAL_ROOT`      | `<cwd>/uploads/media` | Volumen permanente de objetos |
| `MEDIA_UPLOAD_TMP_DIR`  | temp del sistema      | Spool temporal de Multer      |
| `MEDIA_MAX_IMAGE_BYTES` | `10485760`            | Máximo por imagen (10 MiB)    |
| `MEDIA_MAX_VIDEO_BYTES` | `262144000`           | Máximo por video (250 MiB)    |

El proxy inverso debe permitir un body al menos igual a `MEDIA_MAX_VIDEO_BYTES`, pero nunca ilimitado. El directorio temporal puede ser efímero; `MEDIA_LOCAL_ROOT` no.

Ejemplo Docker Compose:

```yaml
services:
  api:
    environment:
      MEDIA_LOCAL_ROOT: /var/lib/api-sorteos/media
      MEDIA_UPLOAD_TMP_DIR: /tmp/api-sorteos-media
    volumes:
      - media_data:/var/lib/api-sorteos/media

volumes:
  media_data:
```

El volumen y MongoDB deben respaldarse como una unidad lógica. El proceso necesita lectura/escritura sobre el volumen, sin servirlo directamente desde Nginx: la API valida estado y `Content-Type`. El soft delete conserva el objeto físico para recuperación; una futura tarea de retención puede purgarlo después del periodo acordado.

## Referencias

`MediaModule` exporta `MediaService`. Campañas, premios u otros módulos deben proteger el asset antes de publicarlo:

```ts
await mediaService.addReference(mediaId, `campaign:${campaignId}`);
// Al retirar definitivamente el vínculo:
await mediaService.removeReference(mediaId, `campaign:${campaignId}`);
```

Las operaciones son atómicas respecto al soft delete: si se añade una referencia primero, el borrado falla; si el borrado gana, ya no se puede añadir la referencia.

## S3/R2

El controlador y MongoDB no dependen del disco local. Para object storage, implementar `MediaStorageProvider` (`put`, `open`, `delete`, `providerName`) y registrar el adaptador:

```ts
MediaModule.register({
  imports: [ConfigModule],
  storage: { useClass: S3MediaStorageProvider },
});
```

El provider debe mantener las mismas garantías: claves opacas, lectura por stream, MIME tomado de Mongo y credenciales nunca expuestas. No se implementó ni activó ningún proveedor externo en este cambio.
