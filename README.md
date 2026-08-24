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

La API queda en `http://127.0.0.1:8080/api/v1`, el health check en
`/api/v1/health` y Swagger en `/api/docs`. Para seguir los logs:

```bash
./deploy-dev.sh --follow
```

La base de datos de desarrollo se publica únicamente en loopback. En producción
Mongo no publica ningún puerto.

## Desarrollo local de Nest

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start:dev
```

Para ejecutar Nest fuera de Compose hay que proporcionar una URI de Mongo válida
con `replicaSet`, además de las variables de `.env.example`. No se debe conectar
el proceso local al usuario raíz de Mongo.

## Autenticación y acceso público

- Los endpoints protegidos usan `Authorization: Bearer <access-token>`.
- Los roles disponibles son `customer`, `operator` y `admin`.
- El pedido público se consulta con `X-Order-Token`.
- El pago público se consulta con `X-Payment-Token`; el secreto nunca se envía
  en la URL ni en query params.
- Las operaciones idempotentes usan `Idempotency-Key`.
- `X-Correlation-Id` permite trazar una petición en logs y auditoría.

Las rutas de autenticación incluyen registro con activación por correo, login,
refresh, logout, recuperación/cambio de contraseña y `GET /api/v1/auth/me`.
El alta pública no emite una sesión hasta confirmar el código enviado al correo.
El frontend debe conservar el `registrationId` opaco devuelto por el alta y
enviarlo en el reenvío y la confirmación; una nueva alta invalida el intento previo.
Las respuestas públicas de usuario no contienen hashes ni contraseñas.

## Configuración

[`.env.example`](./.env.example) es el contrato documentado. Los grupos críticos
son:

| Grupo     | Variables principales                                                                  |
| --------- | -------------------------------------------------------------------------------------- |
| Mongo     | `MONGO_ROOT_*`, `MONGO_APP_*`, `MONGO_REPLICA_SET`, `MONGO_REPLICA_KEY`, `MONGODB_URI` |
| Auth      | `JWT_SECRET`, `EMAIL_CODE_SECRET`, `CHECKOUT_ACCESS_SECRET_KEY`                        |
| Navegador | `CORS_ORIGINS`, `TRUST_PROXY`, `SWAGGER_ENABLED`                                       |
| Correo    | `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, y opcionalmente `SMTP_USER` + `SMTP_PASS`       |
| Pagos     | `PAYMENTS_PROVIDER`, `PAYMENTS_PUBLIC_SECRET_KEY`, `EFI_PIX_*`, `EFI_WEBHOOK_*`        |
| Sorteos   | `CAIXA_FEDERAL_*`, flags `DRAW_*` y baliza NIST allowlisted                            |
| Medios    | `MEDIA_LOCAL_ROOT`, límites de imagen/video y directorio temporal                      |
| Push      | `NOTIFICATION_PUSH_PROVIDER`, las tres `WEB_PUSH_VAPID_*` y límites opcionales          |

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

No use `docker compose down -v`: elimina de forma irreversible la base, el
keyfile y los medios.

## Pruebas y calidad

```bash
pnpm lint
pnpm test
pnpm build
```

## Producción

La guía operativa, backups, rotación de secretos, proxy y recuperación está en
[DEPLOYMENT.md](./DEPLOYMENT.md). El flujo validado es:

```bash
./setup-env.sh
# completar .env.server y copiar el certificado EFI
./deploy-prod.sh
./diagnose.sh
```
