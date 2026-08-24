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
- `age` para backups cifrados; `rclone` es opcional si el destino off-site lo
  usa.
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

   Antes de aplicar cambios puede ejecutar un preflight sin modificar servicios:

   ```bash
   ./deploy-prod.sh --check
   ```

4. Despliegue:

   ```bash
   ./deploy-prod.sh
   ```

   El script valida el entorno y el certificado, ejecuta
   `docker compose config --quiet`, construye con el lockfile congelado y espera
   los health checks. No detiene previamente el stack, no poda imágenes y no
   elimina volúmenes ni servicios de perfiles opcionales.

5. Compruebe el resultado:

   ```bash
   ./diagnose.sh
   curl --fail http://127.0.0.1:8017/api/v1/health
   ```

## Proxy TLS

En CloudPanel o en el balanceador configure el destino
`http://127.0.0.1:8017`. Debe conservar `Host` y sobrescribir
`X-Real-IP`/`X-Forwarded-For` con la IP de la conexión, además de fijar
`X-Forwarded-Proto`. Nunca reenvíe esos encabezados tal como los envió el
cliente. Abra públicamente solo 80/443; el
puerto 8017 permanece ligado a loopback.

Si se desea usar además el rate limiting del Nginx incluido:

```bash
./deploy-prod.sh --with-nginx
```

En ese caso el proxy TLS debe apuntar a `http://127.0.0.1:8081`. No configure
HSTS en esta capa HTTP; hágalo donde termina TLS. El proxy admite cuerpos de
hasta 260 MiB, protege especialmente registro/login/refresh/recuperación y
mantiene timeouts acotados.

Al activar este perfil, el health final se consulta por `HTTP_PORT` y atraviesa
nginx. Las ejecuciones posteriores detectan el contenedor existente y conservan
el perfil aunque se omita `--with-nginx`; tampoco se usa `--remove-orphans`.
Así una actualización rutinaria no elimina accidentalmente el proxy que recibe
tráfico.

Si activa mTLS para el webhook, el proxy que termina TLS debe validar realmente
el certificado cliente y **sobrescribir** (no reenviar) la cabecera configurada,
por ejemplo `proxy_set_header x-ssl-client-verify $ssl_client_verify;`. Con HMAC,
envíe el valor por `x-efi-webhook-token`; evite query params. El access log del
Nginx incluido omite el query string para no persistir secretos heredados.

Swagger está deshabilitado por defecto en producción. Si se habilita de forma
temporal, su ruta es `/api/docs`.

## Variables y validación de producción

La aplicación se niega a iniciar si falta alguna garantía esencial:

- `JWT_SECRET`, `PAYMENTS_PUBLIC_SECRET_KEY`, `CHECKOUT_ACCESS_SECRET_KEY` y
  `REFERRAL_IP_HASH_SECRET` tienen al menos 32 caracteres.
- `EMAIL_CODE_SECRET` tiene al menos 32 caracteres, o se usa el secreto JWT.
- `MONGODB_URI` es una URI Mongo con `replicaSet` (o una URI SRV).
- `MEDIA_LOCAL_ROOT` es absoluto; Compose lo fija en `/app/uploads/media`.
- El almacenamiento de medios tiene cuota global (50 GiB), por usuario
  (10 GiB) y retención de borrados (30 días) configurables con
  `MEDIA_MAX_TOTAL_STORED_BYTES`, `MEDIA_MAX_STORED_BYTES_PER_USER` y
  `MEDIA_DELETED_RETENTION_DAYS`. Los borrados lógicos siguen contando mientras
  ocupen disco.
- El proveedor de producción es EFI, sus credenciales están presentes y el
  certificado existe dentro del contenedor.
- El webhook tiene `EFI_WEBHOOK_HMAC` de al menos 24 caracteres o mTLS activo.

Web Push es opcional y se selecciona explícitamente con
`NOTIFICATION_PUSH_PROVIDER=noop|webpush`. `noop` nunca envía ni se activa por
detectar claves VAPID. `webpush` requiere `WEB_PUSH_VAPID_SUBJECT`,
`WEB_PUSH_VAPID_PUBLIC_KEY` y `WEB_PUSH_VAPID_PRIVATE_KEY` completas y válidas.
TTL, timeout, urgencia, tamaño, concurrencia, hosts permitidos y el máximo de
suscripciones activas por usuario (10 por defecto, máximo 50) se ajustan con las
variables `WEB_PUSH_*` de la plantilla.

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

Todos los servicios usan el driver `json-file` con rotación. Los valores por
defecto conservan cinco archivos de 10 MiB por contenedor y pueden ajustarse con
`DOCKER_LOG_MAX_SIZE` y `DOCKER_LOG_MAX_FILES` (máximo 20). Esta política acota
el disco del host; el histórico duradero debe enviarse a un colector externo.

Los 5xx inesperados se registran como eventos estructurados
`http.unexpected_error` con estado, método, ruta sin query string, correlation
ID, tipo de error y marcos de pila. Nunca se incluyen body, cabeceras, query ni
el mensaje original de la excepción. El mismo correlation ID se devuelve en
`X-Correlation-Id` y en el cuerpo de error para localizar el evento sin exponer
credenciales.

Los eventos de auditoría administrativa conservan 365 días por defecto. Ajuste
`AUDIT_RETENTION_DAYS` entre 1 y 3650 según sus obligaciones legales; Mongo
aplica el vencimiento TTL sin que el proceso tenga que borrar lotes manualmente.

Los correos transaccionales de compras invitadas se guardan primero en
`transactional_email_outbox`. Si SMTP falla, el evento vuelve a `pending` y el
worker reintenta automáticamente con backoff (hasta una hora), manteniendo
`eventKey` idempotente para no duplicar el envío. Configure una alerta sobre
registros `pending` con `attempts` crecientes/`lastError`, registros
`processing` anormalmente antiguos y los errores SMTP de la API: el reintento
evita perder el correo, pero no sustituye la monitorización de credenciales,
cuota o caída prolongada del proveedor.

Nest no usa su parser implícito: JSON está fijado en 512 KiB (suficiente para
los 200 KiB admitidos por las reglas de campaña) y formularios URL-encoded en
128 KiB con un máximo de 100 parámetros. Estos valores no son configurables. El
límite de 260 MiB de nginx sólo habilita uploads multipart, que además pasan por
los límites y validaciones propios del módulo de medios.

No use `down -v`, `volume rm`, `system prune --volumes` ni borre los directorios
de Docker: esas acciones eliminan datos o medios.

## Backups cifrados y recuperables

El backup canónico incluye Mongo y medios en un único bundle con manifiesto y
SHA-256. Para que ambas partes correspondan al mismo estado práctico, el script
abre una ventana breve de mantenimiento: detiene sólo `api-sorteos`, genera el
volcado y el archivo del volumen, y reinicia la API incluso ante un error. Los
webhooks deben reintentarse desde el proveedor; prográmelo en una franja de baja
actividad. Para cero downtime se necesita snapshot coordinado del proveedor de
volúmenes y un replica set externo, no dos copias independientes.

Se recomienda `age`. Genere la identidad fuera de Git y guarde además una copia
offline de la clave privada:

```bash
install -d -m 700 runtime
age-keygen -o runtime/backup-age-key.txt
chmod 600 runtime/backup-age-key.txt
age-keygen -y runtime/backup-age-key.txt
```

Copie únicamente el destinatario público mostrado por el último comando a
`BACKUP_AGE_RECIPIENT` y deje
`BACKUP_AGE_IDENTITY_FILE=./runtime/backup-age-key.txt`. El script rechaza una
copia sin cifrar salvo que el operador pase deliberadamente
`--allow-unencrypted`.

```bash
./operations/backup-prod.sh
./operations/verify-backup.sh runtime/backups/api-sorteos-FECHA.tar.age
```

`BACKUP_OFFSITE_DIR` permite una segunda copia atómica en un filesystem montado
fuera del host. `BACKUP_RCLONE_REMOTE` permite un destino como
`proveedor:cubo/sorteos`; las credenciales permanecen en la configuración
privada de rclone y el script usa modo silencioso. Puede usar ambos destinos.
Si no configura ninguno, el script avisa porque una copia en el mismo host no
cubre pérdida del servidor. No hay borrado automático: aplique una política de
ciclo de vida en el almacén remoto (por ejemplo, 30 diarios y 12 mensuales) y
evite que un error de ruta elimine copias válidas.

Automatice la ejecución con `flock` o un timer que impida solapamientos, revise
su código de salida y alerte si falta el artefacto off-site. Verifique cada copia
y ejecute al menos mensualmente un simulacro aislado:

```bash
flock -n runtime/backup.lock ./operations/backup-prod.sh
./operations/restore-drill.sh runtime/backups/api-sorteos-FECHA.tar.age
```

El simulacro valida ambos hashes, rechaza rutas/enlaces inseguros, restaura
Mongo y medios en contenedor/volúmenes con nombres nuevos y detiene el Mongo de
prueba. Por defecto conserva esos recursos para inspección y muestra el comando
exacto de limpieza; `--cleanup` autoriza eliminar únicamente los recursos
aislados recién creados. Nunca conecta ni escribe en los volúmenes productivos.

Ante un desastre real, primero valide el archivo y el simulacro. Prepare un
stack nuevo con volúmenes vacíos y secretos nuevos, restaure allí el
`mongo.archive.gz` con `mongorestore` y `media.tar.gz` en el volumen de medios,
compruebe conteos, campañas, archivos y health, y sólo entonces cambie el proxy.
No use `--drop`, no extraiga sobre `media-data-prod` existente y no reutilice un
proyecto productivo hasta contar con aprobación y una copia inmutable anterior.

En el host de reemplazo, descifre el bundle en un directorio privado sobre disco
cifrado o tmpfs y restaure únicamente después de comprobar que los volúmenes
son nuevos y están vacíos:

```bash
install -d -m 700 runtime/restore-staging
age --decrypt --identity runtime/backup-age-key.txt \
  --output runtime/restore-staging/bundle.tar BACKUP.tar.age
tar -xf runtime/restore-staging/bundle.tar -C runtime/restore-staging

docker compose --env-file .env.server -f docker-compose.prod.yml \
  up -d --wait mongodb mongo-init-replica
docker compose --env-file .env.server -f docker-compose.prod.yml exec -T mongodb \
  /bin/bash -ec 'exec mongorestore --quiet --host 127.0.0.1 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' \
  < runtime/restore-staging/mongo.archive.gz
docker compose --env-file .env.server -f docker-compose.prod.yml \
  run --rm --no-deps -T --entrypoint /bin/sh api-sorteos \
  -ec 'test -z "$(find /app/uploads/media -mindepth 1 -print -quit)" && exec tar -C /app/uploads/media -xzf -' \
  < runtime/restore-staging/media.tar.gz
./deploy-prod.sh
./diagnose.sh
```

Retire el staging descifrado al terminar conforme a la política del soporte; en
SSD o almacenamiento virtual el borrado simple no equivale a borrado seguro.

## Rotación de secretos

- Cambiar `JWT_SECRET` invalida sólo los access tokens JWT firmados con la clave
  anterior. Los refresh tokens son opacos y persisten en Mongo, por lo que
  podrían canjearse por un access token nuevo después de la rotación.
- Para cerrar una sesión concreta use logout; cambiar la contraseña o desactivar
  una cuenta incrementa su `authVersion` e invalida también sus refresh
  anteriores. En una rotación global o incidente ejecute primero:

  ```bash
  ./operations/revoke-all-sessions.sh --confirm REVOKE-ALL-SESSIONS
  ```

  El script incrementa `authVersion` de todos los usuarios y marca como revocadas
  las `refresh_sessions` activas, con confirmación explícita y sin mostrar
  credenciales. Pausa brevemente la API para impedir nuevas sesiones durante el
  corte y la reinicia incluso si la operación falla. Después cambie `JWT_SECRET`
  y redespliegue.
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
