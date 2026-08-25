# API Sorteos

Backend NestJS para campañas y rifas, usuarios, pedidos con reserva temporal,
checkout, pagos Pix, premios, sorteos, medios, notificaciones, referidos,
configuración pública y auditoría administrativa.

## Requisitos

- Node.js 24.11 o superior dentro de la rama 24 y pnpm 9 para desarrollo local.
- Docker Engine y Docker Compose v2.20 o superior para el entorno recomendado.
- MongoDB en replica set. Los pedidos, pagos y premios usan transacciones; una
  instancia Mongo standalone no es una configuración válida.

## Inicio rápido con Docker

El script crea un archivo local ignorado por Git, genera secretos aleatorios y
levanta Mongo como replica set de un nodo:

```bash
./deploy-dev.sh
```

La API queda en `http://127.0.0.1:8080/api/v1`, el panel administrativo en
`http://127.0.0.1:8080/admin`, el health check en `/api/v1/health` y Swagger en
`/api/docs`. Mailpit captura los correos de desarrollo en
`http://127.0.0.1:8025`; desde esa bandeja puede copiar el código necesario para
confirmar un registro de cliente. Para seguir los logs:

```bash
./deploy-dev.sh --follow
```

La base de datos de desarrollo se publica únicamente en loopback. En producción
Mongo no publica ningún puerto.

## Desarrollo local del monolito

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm start:dev
```

Este comando inicia Nest en el puerto 8080 y Vite en el 5173. Durante desarrollo
el panel se abre en `http://localhost:5173/admin/`; Vite reenvía `/api` a Nest.
`pnpm build` compila ambos y Nest sirve los archivos resultantes desde `/admin`
en producción. No se necesita desplegar ni mantener un segundo servidor.

El acceso admite únicamente cuentas `operator` o `admin`. El refresh token del
panel permanece en una cookie `HttpOnly`, `SameSite=Strict` y `Secure` en
producción; React conserva en memoria solo el access token corto. Si la base aún
no tiene administrador, compile el servidor y ejecute una sola vez el bootstrap
con las variables `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PHONE`,
`BOOTSTRAP_ADMIN_PASSWORD` y, opcionalmente, `BOOTSTRAP_ADMIN_EMAIL`/`CPF`:

```bash
pnpm build:server
pnpm bootstrap:admin
```

El bootstrap es transaccional e idempotente: después de inicializarse no permite
crear administradores adicionales por esta vía. La guía funcional completa del
panel está en [ADMIN-PANEL.md](./ADMIN-PANEL.md).

En el primer despliegue Docker, cree el administrador sin persistir su
contraseña en Compose. Con el servicio ya levantado:

```bash
export BOOTSTRAP_ADMIN_NAME='Administrador inicial'
export BOOTSTRAP_ADMIN_PHONE='+5511999999999'
read -s BOOTSTRAP_ADMIN_PASSWORD && export BOOTSTRAP_ADMIN_PASSWORD
docker compose --env-file .env.server -f docker-compose.prod.yml exec \
  -e BOOTSTRAP_ADMIN_NAME -e BOOTSTRAP_ADMIN_PHONE \
  -e BOOTSTRAP_ADMIN_PASSWORD api-sorteos node dist/bootstrap-admin.js
unset BOOTSTRAP_ADMIN_PASSWORD
```

El comando recibe las variables solo durante esa ejecución. No las añada a
`docker-compose.prod.yml` ni las conserve después del bootstrap.

Para ejecutar Nest fuera de Compose hay que proporcionar una URI de Mongo válida
con `replicaSet`, además de las variables de `.env.example`. No se debe conectar
el proceso local al usuario raíz de Mongo.

## Autenticación y acceso público

- Los endpoints protegidos usan `Authorization: Bearer <access-token>`.
- Los roles disponibles son `customer`, `operator` y `admin`.
- El pedido público se consulta con `X-Order-Token`.
- El pago público se consulta con `X-Payment-Token`; el secreto nunca se envía
  en la URL ni en query params.
- Los tokens de pedido/pago caducan en el servidor (24 horas por defecto) y los
  de juego instantáneo a las 12 horas. Después se exige sesión o recuperación.
- Las operaciones idempotentes usan `Idempotency-Key`.
- `X-Correlation-Id` permite trazar una petición en logs y auditoría.

Las rutas de autenticación incluyen registro con activación por correo, login,
refresh, logout, recuperación/cambio de contraseña y `GET /api/v1/auth/me`.
El alta pública no emite una sesión hasta confirmar el código enviado al correo.
El frontend debe conservar el `registrationId` opaco devuelto por el alta y
enviarlo en el reenvío y la confirmación; una nueva alta invalida el intento previo.
Las respuestas públicas de usuario no contienen hashes ni contraseñas.

El SPA de clientes debe usar exclusivamente `/api/v1/client/session`: ofrece
`register`, `register/resend`, `register/confirm`, `login`, `refresh`, `logout`,
`me` y los flujos `password/reset/*` y `password/change`. En esta superficie el
refresh token nunca aparece en JSON: se rota en la cookie host-only
`sorteos_client_refresh`, `HttpOnly`, `Secure` en producción y limitada a esa
ruta; el access token corto sí se devuelve para conservarlo solo en memoria.
Todas las mutaciones deben enviar `X-Client-Session: browser` y el `fetch` del
SPA debe usar `credentials: 'include'`. Solo el rol `customer` puede obtener o
renovar esta sesión. `CORS_ORIGINS` debe enumerar exactamente los orígenes del
SPA y del panel, ya que CORS admite credenciales y no acepta comodines. La
sesión administrativa tiene una comprobación adicional e independiente:
`ADMIN_PANEL_ORIGINS` solo enumera orígenes del panel y es obligatorio en
producción mientras el panel esté habilitado. No incluya allí el portal cliente,
aunque ambos pasen por el mismo proxy o compartan sitio registrable.

`CLIENT_SESSION_COOKIE_SAME_SITE=lax` es el valor recomendado cuando web y API
comparten sitio registrable (también si usan subdominios). Use `none` únicamente
si están en sitios distintos y ambos se sirven por HTTPS; en ese modo la API
fuerza igualmente `Secure`. `strict` está disponible para despliegues del mismo
sitio que no necesiten navegaciones cruzadas.

## Configuración

[`.env.example`](./.env.example) es el contrato documentado. Los grupos críticos
son:

| Grupo     | Variables principales                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Mongo     | `MONGO_ROOT_*`, `MONGO_APP_*`, `MONGO_REPLICA_SET`, `MONGO_REPLICA_KEY`, `MONGODB_URI`                     |
| Auth      | `JWT_SECRET`, `EMAIL_CODE_SECRET`, `CHECKOUT_ACCESS_SECRET_KEY`                                            |
| Navegador | `CORS_ORIGINS`, `ADMIN_PANEL_ORIGINS`, `CLIENT_SESSION_COOKIE_SAME_SITE`, `TRUST_PROXY`, `SWAGGER_ENABLED`, `ADMIN_PANEL_ENABLED` |
| Correo    | `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, y opcionalmente `SMTP_USER` + `SMTP_PASS`                           |
| Pagos     | `PAYMENTS_PROVIDER`, `PAYMENTS_PUBLIC_SECRET_KEY`, `EFI_PIX_*`, `EFI_WEBHOOK_*`                            |
| Sorteos   | `CAIXA_FEDERAL_*`, flags `DRAW_*` y baliza NIST allowlisted                                                |
| Medios    | `MEDIA_LOCAL_ROOT`, límites de imagen/video y directorio temporal                                          |
| Push      | `NOTIFICATION_PUSH_PROVIDER`, las tres `WEB_PUSH_VAPID_*` y límites opcionales                             |
| Accesos   | `ORDER_ACCESS_TOKEN_HOURS`, `PAYMENT_ACCESS_TOKEN_HOURS`, `PRIZE_ACCESS_TOKEN_HOURS`                      |
| Privacidad | `AUDIT_RETENTION_DAYS`, `REFERRAL_CLICK_RETENTION_DAYS`                                                  |

En producción, los secretos de aplicación deben tener al menos 32 caracteres.
`NOTIFICATION_PUSH_PROVIDER` selecciona explícitamente `noop` (predeterminado)
o `webpush`. El modo `noop` mantiene operativo el inbox interno y no se activa
por la mera presencia de claves. `webpush` exige las tres variables VAPID
(`SUBJECT`, `PUBLIC_KEY`, `PRIVATE_KEY`). Cada usuario admite como máximo 10
suscripciones activas por defecto, configurable entre 1 y 50.

Las campañas que usan Lotería Federal deben fijar `closesAt`, número de concurso
y una `drawDate` de un día posterior antes de programarse o abrir ventas. La API confirma dos veces que CAIXA lo
anuncia como próximo concurso aún no publicado y que la fecha oficial coincide.
Al verificar, el operador no introduce números, premios adicionales ni URLs: la
API vuelve a conciliar dos lecturas oficiales, exige que el sorteo sea posterior
al cierre efectivo de ventas y conserva cuerpos, hashes SHA-256 y metadatos
acotados como evidencia de auditoría.
La plantilla usa `servicebus3.caixa.gov.br`; por compatibilidad se admite
también el host oficial `servicebus2.caixa.gov.br`, sin puertos, redirecciones
ni rutas configurables fuera del endpoint Federal.

El método criptográfico tampoco acepta entropía del operador: antes de vender
congela `closesAt` y `drawDate`, y combina la revelación con el primer pulso
HTTPS de la baliza NIST a partir de ese instante ya comprometido, conservando
pulso, firma, certificado y hash del cuerpo. Los métodos
`manual_external` y `cryptographic` están deshabilitados por defecto en
producción y requieren habilitación explícita. La verificación manual y la
publicación final son exclusivas de ADMIN; además, la misma identidad no puede
verificar y publicar.
La selección temporal sigue la API oficial documentada de
[NIST Randomness Beacon 2.0](https://csrc.nist.gov/projects/interoperable-randomness-beacons/beacon-20).

Para generar el entorno de producción:

```bash
./setup-env.sh
```

El resultado es `.env.server` con permisos `0600`; Git lo ignora. El script no
inventa credenciales SMTP o EFI: deben completarse con los valores del proveedor.

## Persistencia y seguridad del contenedor

- La imagen usa Node 24, instala con `pnpm --frozen-lockfile` y se ejecuta con un
  usuario sin privilegios.
- El filesystem de la API es de solo lectura. `/tmp` es efímero y los medios se
  guardan en un volumen persistente.
- Mongo usa un keyfile interno, autenticación y usuarios raíz/aplicación
  separados. La aplicación solo recibe permisos `readWrite` sobre su base.
- El proxy Nginx opcional escucha HTTP en loopback; TLS se termina en el proxy de
  borde (CloudPanel, balanceador o equivalente).
- El proxy usa Nginx 1.30.4 fijado por digest. Los medios se transmiten sin
  buffering temporal y mantienen soporte para byte ranges.

No use `docker compose down -v`: elimina de forma irreversible la base, el
keyfile y los medios.

## Pruebas y calidad

```bash
pnpm verify
```

`verify` comprueba lint, compilación Nest + React, pruebas Jest y pruebas Vitest
del panel. También pueden ejecutarse por separado con `pnpm build:admin` y
`pnpm test:admin`.

## Producción

La guía operativa, backups, rotación de secretos, proxy y recuperación está en
[DEPLOYMENT.md](./DEPLOYMENT.md). El flujo validado es:

```bash
./setup-env.sh
# completar .env.server y copiar el certificado EFI
./deploy-prod.sh
./diagnose.sh
```
