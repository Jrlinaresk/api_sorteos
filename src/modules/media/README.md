# Media: almacenamiento seguro e integración

## Endpoints

- `GET /api/v1/admin/media`: biblioteca paginada. Admite `page`, `limit` (máximo 100), `status`, `kind`, `mimeType`, `uploadedBy`, `referenced` y búsqueda literal por `search`. Requiere rol `operator` o `admin`.
- `GET /api/v1/admin/media/storage-usage`: uso global, uso del operador y cuotas vigentes.
- `POST /api/v1/admin/media`: `multipart/form-data`, campo `file`. Requiere JWT y rol `operator` o `admin`.
- `DELETE /api/v1/admin/media/:mediaId`: requiere JWT y rol `admin`. Es un soft delete y sólo funciona si `references` está vacío.
- `DELETE /api/v1/admin/media/:mediaId/purge`: requiere rol `admin`. Borra físicamente sólo un medio previamente eliminado, sin referencias y cuyo periodo de retención ya terminó. Es reintentable si el proceso se interrumpe.
- `GET /api/v1/media/:mediaId`: público. Entrega únicamente assets activos con `Content-Type`, `Content-Length`, `ETag`, cache, `Accept-Ranges` y `X-Content-Type-Options: nosniff`.
- `HEAD /api/v1/media/:mediaId`: devuelve los mismos metadatos sin abrir un stream.

Sólo se aceptan JPEG, PNG, WebP, MP4 y WebM. Se comprueban tanto el MIME como los magic bytes. SVG, HTML y cualquier payload base64 están fuera del contrato. El nombre del cliente nunca se usa como ruta; los objetos reciben nombres criptográficos.

`GET` acepta un único `Range: bytes=...`. Responde `206` con `Content-Range` cuando es satisfacible y `416` con `Content-Range: bytes */<tamaño>` cuando no lo es; no construye respuestas multipart. `If-None-Match` admite el ETag fuerte o débil y responde `304` sin crear un stream. El provider local usa `createReadStream({ start, end })`, por lo que buscar dentro de un video no carga ni recorre el archivo completo.

## Configuración local

| Variable                          | Predeterminado        | Uso                           |
| --------------------------------- | --------------------- | ----------------------------- |
| `MEDIA_LOCAL_ROOT`                | `<cwd>/uploads/media` | Volumen permanente de objetos |
| `MEDIA_UPLOAD_TMP_DIR`            | temp del sistema      | Spool temporal de Multer      |
| `MEDIA_MAX_IMAGE_BYTES`           | `10485760`            | Máximo por imagen (10 MiB)    |
| `MEDIA_MAX_VIDEO_BYTES`           | `262144000`           | Máximo por video (250 MiB)    |
| `MEDIA_MAX_TOTAL_STORED_BYTES`    | `53687091200`         | Cuota física global (50 GiB)  |
| `MEDIA_MAX_STORED_BYTES_PER_USER` | `10737418240`         | Cuota por operador (10 GiB)   |
| `MEDIA_DELETED_RETENTION_DAYS`    | `30`                  | Espera mínima antes de purgar |

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

El volumen y MongoDB deben respaldarse como una unidad lógica. El proceso necesita lectura/escritura sobre el volumen, sin servirlo directamente desde Nginx: la API valida estado y `Content-Type`. El soft delete conserva el objeto físico y continúa contabilizándolo. Las reservas de cuota usan contadores atómicos de Mongo, de modo que uploads concurrentes no pueden rebasar los límites. Sólo una purga administrativa posterior a la retención elimina el archivo y libera la cuota.

## Referencias

`MediaModule` exporta `MediaService`. Campañas, premios u otros módulos deben proteger el asset antes de publicarlo:

```ts
await mediaService.addReference(mediaId, `campaign:${campaignId}`);
// Al retirar definitivamente el vínculo:
await mediaService.removeReference(mediaId, `campaign:${campaignId}`);
```

Las operaciones son atómicas respecto al soft delete: si se añade una referencia primero, el borrado falla; si el borrado gana, ya no se puede añadir la referencia.

## S3/R2

El controlador y MongoDB no dependen del disco local. Para object storage, implementar `MediaStorageProvider` (`put`, `stat`, `open`, `delete`, `providerName`) y registrar el adaptador:

```ts
MediaModule.register({
  imports: [ConfigModule],
  storage: { useClass: S3MediaStorageProvider },
});
```

`stat` debe devolver tamaño y fecha sin descargar el objeto. `open` recibe opcionalmente `{ start, end }`, debe solicitar ese rango al proveedor remoto y declarar tanto el tamaño total como `contentLength`. El provider debe mantener las mismas garantías: claves opacas, lectura por stream, MIME tomado de Mongo y credenciales nunca expuestas. No se implementó ni activó ningún proveedor externo en este cambio.
