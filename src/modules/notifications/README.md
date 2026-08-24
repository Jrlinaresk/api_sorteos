# Notifications: contrato e integración

## Seguridad HTTP

- `GET /notifications/me`, contador, lectura, preferencias y suscripciones exigen JWT y siempre usan el `id` de `CurrentUser`. Ningún DTO público acepta `userId`.
- `POST /admin/notifications` y `POST /admin/notifications/:id/deliver` exigen JWT y rol `operator` o `admin`. El autor (`createdBy`) se deriva del JWT, no del cuerpo.
- Las respuestas de suscripción nunca incluyen endpoint/token, credenciales, metadata ni `userId`. El inbox tampoco expone estado interno de entrega.
- Registrar un endpoint que ya pertenece a otro usuario devuelve conflicto; no transfiere silenciosamente su propiedad.
- Para `web_push`, el endpoint debe ser HTTPS y pertenecer a un host permitido; `credentials` debe contener exactamente `p256dh` y `auth` válidos. Esto evita usar el envío push como SSRF.
- Endpoint, claves de suscripción y VAPID privada nunca aparecen en presenters, errores persistidos ni configuración pública.

## Hook interno

Otros módulos pueden inyectar `NotificationsService` (exportado por `NotificationsModule`) y llamar:

```ts
await notificationsService.create({
  userId,
  eventKey: `payment:${paymentId}:paid`,
  title: 'Pago confirmado',
  body: 'Tus títulos ya están disponibles.',
  type: NotificationType.Payment,
  data: { orderId },
  deliverPush: true,
});
```

El hook persiste primero el inbox. `deliverPush` es best-effort y no debe controlar la transacción de negocio. No se deben colocar secretos, tokens de pago ni PII sensible en `data`.

Los productores reintentables (fulfillment/outbox) deben enviar un `eventKey`
estable de 8 a 160 caracteres. La combinación `userId + eventKey` es única: un
replay concurrente devuelve el documento existente y no vuelve a crear el inbox
ni a disparar la entrega push. No use UUID aleatorios por intento.

Eventos recomendados para integrarlo posteriormente: `order.created`, `payment.approved`, `payment.expired`, `draw.completed` y `winner.confirmed`.

## Web Push con VAPID

`NotificationsModule` selecciona el provider únicamente mediante
`NOTIFICATION_PUSH_PROVIDER`:

- `noop` (predeterminado) usa `NoopNotificationPushProvider`; el inbox funciona y la entrega queda `skipped` con código `not_configured`. Aunque existan claves VAPID, este modo nunca activa envíos.
- `webpush` usa `WebPushNotificationProvider` basado en el paquete estándar `web-push` y exige las tres variables VAPID completas y válidas.
- Un selector desconocido o una configuración incompleta hacen fallar el arranque; no hay cambio implícito de proveedor.

Generar el par una sola vez:

```bash
pnpm exec web-push generate-vapid-keys --json
```

Guardar la clave privada en el secret manager del entorno; no incluirla en Git, frontend, logs o respuestas.

| Variable                          | Obligatoria/predeterminado | Descripción                                                                              |
| --------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `NOTIFICATION_PUSH_PROVIDER`      | `noop`                     | Selector estricto: `noop` o `webpush`                                                    |
| `WEB_PUSH_VAPID_SUBJECT`          | Obligatoria para activar   | `mailto:soporte@dominio.com` o URL HTTPS de contacto                                     |
| `WEB_PUSH_VAPID_PUBLIC_KEY`       | Obligatoria para activar   | Clave pública Base64 URL-safe de 65 bytes                                                |
| `WEB_PUSH_VAPID_PRIVATE_KEY`      | Obligatoria para activar   | Clave privada Base64 URL-safe de 32 bytes                                                |
| `WEB_PUSH_TTL_SECONDS`            | `300`                      | Retención upstream, entre 0 y 2419200 segundos                                           |
| `WEB_PUSH_TIMEOUT_MS`             | `10000`                    | Timeout de socket, entre 1000 y 120000 ms                                                |
| `WEB_PUSH_URGENCY`                | `normal`                   | `very-low`, `low`, `normal` o `high`                                                     |
| `WEB_PUSH_MAX_PAYLOAD_BYTES`      | `3500`                     | Presupuesto UTF-8, máximo 4096 bytes                                                     |
| `WEB_PUSH_MAX_CONCURRENCY`        | `10`                       | Envíos simultáneos, entre 1 y 50                                                         |
| `WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER` | `10`                  | Suscripciones activas y destinos por entrega, entre 1 y 50                               |
| `WEB_PUSH_ALLOWED_ENDPOINT_HOSTS` | Lista segura integrada     | Lista CSV que reemplaza los hosts admitidos; acepta patrones como `*.notify.windows.com` |

La lista integrada admite FCM/Chrome, Mozilla, Apple Web Push y Windows Push. Si el navegador entrega un host distinto, añadirlo explícitamente tras verificar que sea el servicio push esperado; no usar comodines globales.

`GET /notifications/push/config` requiere JWT y devuelve únicamente:

```json
{
  "enabled": true,
  "provider": "web-push",
  "vapidPublicKey": "clave-publica"
}
```

El frontend usa `vapidPublicKey` en `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` y registra el resultado con `POST /notifications/subscriptions`:

```json
{
  "provider": "web_push",
  "address": "https://fcm.googleapis.com/fcm/send/endpoint-opaco",
  "credentials": {
    "p256dh": "clave-publica-de-la-suscripcion",
    "auth": "secreto-auth-de-la-suscripcion"
  }
}
```

El service worker recibe JSON con `{ "version": 1, "notification": { ... } }`. Debe mostrar una notificación visible y validar `actionUrl` antes de navegar.

Los resultados administrativos guardan provider, código, aceptadas, rechazadas e inválidas. Respuestas upstream 404/410 marcan el endpoint como `expired`; suscripciones locales vencidas también se desactivan antes de enviar. Los textos persistidos son resúmenes controlados y nunca copian cuerpos upstream, endpoints ni excepciones crudas.

El registro reserva uno de los cupos únicos del usuario. Esto impide superar el
límite incluso ante solicitudes concurrentes; desregistrar, expirar o invalidar
una suscripción libera su cupo. Las cuentas con datos anteriores al límite solo
entregan al lote más reciente y acotado.

Para sustituir Web Push por otro transporte, implementar `NotificationPushProvider` y usar `NotificationsModule.register({ provider: ... })`. El token `NOTIFICATION_PUSH_PROVIDER` continúa exportado.
