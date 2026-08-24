# Despliegue seguro de API Sorteos

## Arquitectura

El despliegue de producción deja únicamente la API enlazada a loopback:

```text
Internet -> proxy TLS/CloudPanel -> 127.0.0.1:8017 -> API:8080
                                                      |
                                                      +-> MongoDB:27017 (red Docker)
```

MongoDB no publica un puerto en producción. Se inicia como replica set de un
nodo con autenticación y keyfile, suficiente para que las transacciones de la
aplicación funcionen. Para alta disponibilidad real deben usarse tres miembros
o un servicio MongoDB administrado.

Los datos viven en cuatro volúmenes:

- `mongo-data-prod`: base de datos.
- `mongo-keyfile-prod`: autenticación interna del replica set.
- `media-data-prod`: imágenes y videos subidos.
- `efi-secrets-prod`: copia de solo lectura para la API de los certificados EFI.

## Requisitos del host

- Linux con Docker Engine actualizado.
- Docker Compose v2.20 o superior (`docker compose`, no `docker-compose`).
- `openssl` y `curl`.
- Un proxy de borde con TLS válido. El Nginx incluido es HTTP interno y no
  almacena certificados del dominio.
- Espacio y backups para Mongo y para el volumen de medios.

## Primer despliegue

1. Genere un archivo de entorno privado:

   ```bash
   ./setup-env.sh
   ```

   El script crea `.env.server` con permisos `0600`, contraseñas aleatorias y
   claves distintas por función. No use `--force` sobre un entorno ya desplegado
   salvo que esté realizando una rotación planificada.

2. Edite `.env.server` y complete, como mínimo:

   - `CORS_ORIGINS` con los orígenes exactos del frontend, separados por coma y
     sin rutas ni `*`.
   - `SMTP_HOST`, `SMTP_PORT` y `SMTP_FROM`. Si SMTP requiere autenticación,
     configure juntos `SMTP_USER` y `SMTP_PASS`.
   - `EFI_PIX_CLIENT_ID`, `EFI_PIX_CLIENT_SECRET`, `EFI_PIX_KEY` y el entorno EFI.
   - Un HMAC de webhook o mTLS. El script genera un HMAC seguro por defecto.

3. Copie el certificado Pix fuera de Git:

   ```bash
   install -m 600 /ruta/privada/certificate.p12 runtime/efi/certificate.p12
   ```

   El valor correspondiente debe ser
   `EFI_PIX_CERTIFICATE_PATH=/run/secrets/efi/certificate.p12`. Para PEM, deje
   vacío ese campo y configure tanto `EFI_PIX_CERT_PATH` como
   `EFI_PIX_KEY_PATH`, siempre bajo `/run/secrets/efi/`.

   Un contenedor de inicialización copia únicamente esos archivos a un volumen,
   los asigna al UID no privilegiado de la API y aplica modo `0400`. La API no
   recibe acceso directo al directorio del host.

4. Despliegue:

   ```bash
   ./deploy-prod.sh
   ```

   El script valida el entorno y el certificado, ejecuta
   `docker compose config --quiet`, construye con el lockfile congelado y espera
   los health checks. No detiene previamente el stack, no poda imágenes y no
   elimina volúmenes.

5. Compruebe el resultado:

   ```bash
   ./diagnose.sh
   curl --fail http://127.0.0.1:8017/api/v1/health
   ```

## Proxy TLS

En CloudPanel o en el balanceador configure el destino
`http://127.0.0.1:8017`. Debe conservar `Host`, `X-Real-IP`,
`X-Forwarded-For` y `X-Forwarded-Proto`. Abra públicamente solo 80/443; el
puerto 8017 permanece ligado a loopback.

Si se desea usar además el rate limiting del Nginx incluido:

```bash
./deploy-prod.sh --with-nginx
```

En ese caso el proxy TLS debe apuntar a `http://127.0.0.1:8081`. No configure
HSTS en esta capa HTTP; hágalo donde termina TLS. El proxy admite cuerpos de
hasta 260 MiB, protege especialmente registro/login/refresh/recuperación y
mantiene timeouts acotados.

Swagger está deshabilitado por defecto en producción. Si se habilita de forma
temporal, su ruta es `/api/docs`.

## Variables y validación de producción

La aplicación se niega a iniciar si falta alguna garantía esencial:

- `JWT_SECRET`, `PAYMENTS_PUBLIC_SECRET_KEY`, `CHECKOUT_ACCESS_SECRET_KEY` y
  `REFERRAL_IP_HASH_SECRET` tienen al menos 32 caracteres.
- `EMAIL_CODE_SECRET` tiene al menos 32 caracteres, o se usa el secreto JWT.
- `MONGODB_URI` es una URI Mongo con `replicaSet` (o una URI SRV).
- `MEDIA_LOCAL_ROOT` es absoluto; Compose lo fija en `/app/uploads/media`.
- El proveedor de producción es EFI, sus credenciales están presentes y el
  certificado existe dentro del contenedor.
- El webhook tiene `EFI_WEBHOOK_HMAC` de al menos 24 caracteres o mTLS activo.

Web Push es opcional. `WEB_PUSH_VAPID_SUBJECT`,
`WEB_PUSH_VAPID_PUBLIC_KEY` y `WEB_PUSH_VAPID_PRIVATE_KEY` deben estar las tres
presentes o las tres ausentes. Sin ellas, las notificaciones siguen disponibles
en el inbox pero no se envían al navegador. TTL, timeout, urgencia, tamaño,
concurrencia y hosts permitidos se ajustan con las variables `WEB_PUSH_*` de la
plantilla.

No ejecute `docker compose config` sin `--quiet` en CI o tickets: la salida
expandida contiene secretos. No muestre ni adjunte `.env.server`.

## Operación diaria

Todos los comandos manuales deben indicar el archivo privado:

```bash
docker compose --env-file .env.server -f docker-compose.prod.yml ps
docker compose --env-file .env.server -f docker-compose.prod.yml logs --tail=100 api-sorteos
docker compose --env-file .env.server -f docker-compose.prod.yml logs --tail=100 mongo-init-replica
```

Para actualizar código use nuevamente `./deploy-prod.sh`. Para volver a una
versión anterior, seleccione un commit conocido y ejecute el mismo script; los
volúmenes no se modifican.

No use `down -v`, `volume rm`, `system prune --volumes` ni borre los directorios
de Docker: esas acciones eliminan datos o medios.

## Backups

Cree un directorio privado y haga backup de Mongo con credenciales tomadas
dentro del contenedor, sin exponerlas en la línea de comandos del host:

```bash
install -d -m 700 backups
docker compose --env-file .env.server -f docker-compose.prod.yml exec -T mongodb \
  /bin/bash -ec 'exec mongodump --host 127.0.0.1 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' \
  > "backups/mongo-$(date +%Y%m%d-%H%M%S).archive.gz"
```

Los medios requieren un backup separado:

```bash
docker run --rm --read-only \
  -v api-sorteos-prod_media-data-prod:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.20 sh -ec 'tar -czf /backup/media.tar.gz -C /data .'
```

Copie ambos artefactos cifrados a almacenamiento externo y pruebe periódicamente
la restauración en otro proyecto Compose. Una copia no probada no es un plan de
recuperación.

## Rotación de secretos

- Cambiar `JWT_SECRET` invalida los access/refresh tokens existentes.
- El usuario Mongo de aplicación se crea o actualiza de forma idempotente al
  desplegar. `MONGO_APP_PASSWORD` y la contraseña codificada en `MONGODB_URI`
  deben cambiar juntas.
- La contraseña raíz de una base ya inicializada no cambia al editar el archivo
  de entorno. Cámbiela autenticado en Mongo durante una ventana de mantenimiento
  y después actualice `.env.server`.
- Al rotar certificados EFI, reemplace el archivo del host y redespliegue; el
  contenedor de inicialización elimina la copia anterior del volumen privado.
- Rote también HMAC, claves Pix, SMTP, secretos de checkout/referidos y claves
  VAPID según las políticas del proveedor.

Una versión anterior del despliegue contenía credenciales Mongo en archivos
versionados. Si ese código fue clonado o desplegado, considere esas credenciales
comprometidas y rótelas aunque ya no aparezcan en la rama actual.

## Diagnóstico

`./diagnose.sh` valida Compose, health HTTP, estado primario/autenticado de Mongo
y permisos del volumen de medios. Ante un fallo revise primero:

```bash
docker compose --env-file .env.server -f docker-compose.prod.yml ps
docker compose --env-file .env.server -f docker-compose.prod.yml logs --tail=200 api-sorteos mongodb mongo-init-replica efi-cert-init
```

Un `502` en el proxy suele indicar que la API no está saludable o que CloudPanel
apunta al puerto equivocado. Un fallo de `mongo-init-replica` suele indicar que
las credenciales raíz del volumen no coinciden con `.env.server`. Un error EFI
al arrancar indica ruta, permisos o formato de certificado incorrectos.
