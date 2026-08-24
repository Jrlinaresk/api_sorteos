# Capacidades del backend para una web de sorteos tipo Uerick07

Este documento describe la superficie **realmente activa** del backend a partir de `AppModule`, sus módulos importados y sus controladores. No representa una maqueta hipotética ni incluye rutas de módulos que existen en el repositorio pero no están montados.

## Conclusión ejecutiva

El backend ya puede alimentar una web de rifas/sorteos con el flujo principal de una campaña como la de referencia: catálogo, página detallada del premio, selector de cantidades y promociones, reserva de títulos, pago Pix, consulta de pedidos, rankings, títulos premiados, juegos instantáneos, resultados, cuenta de usuario, referidos, notificaciones y administración.

La apariencia exacta no la produce este proyecto: debe construirse un frontend web que consuma la API. HTML, CSS, componentes, navegación, animaciones, PWA, SEO renderizado y scripts de analítica pertenecen al frontend. No hace falta duplicar la lógica crítica en el navegador: precios, promociones, asignación de títulos, caducidad, estados de pago, premios y resultados se calculan o validan en el servidor.

Todas las rutas REST funcionales usan el prefijo:

```text
/api/v1
```

En las tablas se omite ese prefijo para facilitar la lectura. Si Swagger está habilitado, la interfaz se monta en `/api/docs`; en producción la configuración propuesta lo desactiva.

### Leyenda de acceso

| Marca | Acceso |
| --- | --- |
| Público | No requiere credenciales. |
| Bearer | Requiere JWT en `Authorization: Bearer ...`. |
| Pedido | Requiere `X-Order-Token`, salvo que el propio endpoint acepte al titular autenticado. |
| Pago | Requiere `X-Payment-Token`. |
| Premio | Requiere `X-Prize-Token`. |
| Operación | Requiere rol `operator` o `admin`. |
| Administración | Requiere rol `admin`. |
| PSP | Llamada del proveedor de pagos protegida por HMAC y/o mTLS. |

## Páginas que puede alimentar

| Página o sección web | Datos y funciones disponibles | Endpoints principales |
| --- | --- | --- |
| Inicio / catálogo | Campañas paginadas; búsqueda; filtros por categoría, estado y destacadas; portada, estado, avance y disponibilidad; marca, tema, contactos, redes y feature flags. | `GET /campaigns`, `GET /categories`, `GET /settings/public`, `GET /media/:mediaId` |
| Detalle de campaña | Hero y galería de imagen/video, descripciones, premio y alternativa en dinero, condición, precio, promociones, sugerencias de cantidad, fechas, contador, avance, aviso temporal, doble oportunidad, contactos sociales, SEO, reglamento y módulos habilitados. | `GET /campaigns/:slug`, `GET /campaigns/:slug/regulations/:version`, `POST /campaigns/:slug/quote` |
| Ranking y transparencia | Mayores compradores, título mínimo/máximo, participantes, CSV público y consulta de un número. Los propietarios se presentan enmascarados. Cada función solo responde si la campaña habilitó su flag correspondiente. | `GET /campaigns/:campaignId/top-buyers`, `GET /campaigns/:campaignId/min-max-quota`, `GET /campaigns/:campaignId/participants`, `GET /campaigns/:campaignId/participants.csv`, `GET /campaigns/:campaignId/titles/:number` |
| Checkout | Cotización definitiva en servidor, validación de CPF y datos del comprador, aceptación de versión exacta del reglamento, reserva transaccional, asignación de títulos, promociones, títulos extra por doble oportunidad y creación idempotente del Pix. Admite invitado o usuario autenticado. | `POST /checkout`, `GET /checkout/:publicId`, `POST /checkout/:publicId/cancel` |
| Pantalla Pix | Estado, QR, copia y pega, vencimiento, conciliación por webhook y cancelación mientras el cobro sea pagable. | La respuesta de `POST /checkout`; `GET /payments/:id`; `GET /checkout/:publicId`; `POST /checkout/:publicId/cancel` |
| “Mis títulos” sin cuenta | Recuperación por teléfono + correo mediante desafío opaco y código de seis dígitos; respuesta antienumeración; desafío con caducidad, cooldown y límite de intentos; confirmación de un solo uso y rotación de los tokens de los pedidos recuperados. Si una identidad supera el máximo seguro, obliga a acotar por campaña. | `POST /orders/access/request`, `POST /orders/access/confirm` |
| Registro, acceso y recuperación de contraseña | Alta pendiente versionada por `registrationId` opaco; cada repetición reemplaza credenciales e invalida el intento anterior. El OTP queda ligado al intento y la activación transaccional exige el mismo identificador antes de emitir sesión; reenvío antienumeración; login; access/refresh tokens; logout y recuperación por correo. | `POST /auth/register`, `POST /auth/register/resend`, `POST /auth/register/confirm`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/password/change`, `POST /auth/password/reset/request`, `POST /auth/password/reset/confirm`, `GET /auth/me` |
| Área del cliente | Perfil, historial paginado de pedidos, detalle de un pedido, títulos pagados por campaña y premios del usuario. | `PATCH /me/profile`, `GET /me/orders`, `GET /me/orders/:publicId`, `GET /me/titles`, `GET /me/prize-awards`, `POST /me/prize-awards/:publicId/claim` |
| Premios instantáneos | Catálogo público de premios y ganadores enmascarados; títulos premiados; intentos de ruleta o raspadinha adjudicados al confirmar un pago; jugada de un solo uso; consulta y reclamación del premio. | `GET /campaigns/:campaignId/prizes`, `GET /prizes/attempts/order/:orderPublicId`, `POST /prizes/attempts/:publicId/play`, `GET /prize-awards/order/:orderPublicId`, `POST /prize-awards/:publicId/claim` |
| Resultados y ganadores | Resultado publicado por campaña o slug, archivo paginado, números ganadores, premios, ganador enmascarado y evidencia verificable. | `GET /campaigns/:campaignIdOrSlug/result`, `GET /results` |
| Afiliado / referidos | Resolución de código sin revelar beneficiario, registro idempotente de click y UTM, resumen y comisiones del afiliado autenticado. La atribución y comisión se ejecutan al confirmar el pago. | `GET /referrals/resolve/:code`, `POST /referrals/clicks`, `GET /referrals/me/summary`, `GET /referrals/me/commissions` |
| Inbox y notificaciones web | Inbox paginado, contador, leído individual/masivo, preferencias, suscripción Web Push y baja de dispositivos. | Rutas bajo `/notifications`; requieren Bearer, incluida actualmente `GET /notifications/push/config`. |
| Legal, contacto y redes | Marca, contacto, WhatsApp, redes, enlaces legales, CNPJ, texto legal y reglamentos versionados por campaña. | `GET /settings/public`, `GET /campaigns/:slug/regulations/:version` |
| Panel de operación | Gestión de campañas, medios, categorías, usuarios, pedidos, pagos, sorteos, premios, configuración, referidos, notificaciones y auditoría. | Rutas administrativas detalladas más abajo. El backend aporta la API; la interfaz del panel debe construirse aparte. |

`slug` es el identificador legible de una campaña. Las rutas de rankings, participantes, premios y administración que indican `campaignId` esperan el ObjectId de MongoDB devuelto como `id` en la vista pública.

## Funciones públicas y contratos reales

### Campañas, configuración, categorías y medios

| Acceso | Ruta | Función |
| --- | --- | --- |
| Público | `GET /campaigns` | Catálogo paginado. Acepta `page`, `limit`, `status`, `category`, `search` y `featured`. No expone borradores ni canceladas. |
| Público | `GET /campaigns/:slug` | Detalle público completo. Indica `isPurchasable`, `progress`, `availableCount`, `cover`, aviso vigente y doble oportunidad vigente. |
| Público | `GET /campaigns/:slug/regulations/:version` | Versión histórica del reglamento con HTML, SHA-256, fecha y marca de versión vigente. |
| Público | `POST /campaigns/:slug/quote` | Calcula cantidad seleccionada, bonus, cantidad asignada, subtotal, descuento, total, moneda, promoción y multiplicador. Solo cotiza campañas comprables. |
| Público | `GET /settings/public` | Última configuración publicada o valores seguros por defecto: marca, contacto, redes, tema, legal y feature flags. Tiene caché HTTP corta. |
| Público | `GET /categories` | Lista de categorías. |
| Público | `GET /categories/search?name=...` | Búsqueda de categorías por nombre. |
| Público | `GET /categories/:id` | Detalle de categoría. |
| Público | `GET /media/:mediaId` | Sirve un medio activo con MIME, tamaño, ETag y cabeceras de caché. |
| Público | `GET /locations/countries` | Países. |
| Público | `GET /locations/states/:countryCode` | Estados/provincias. |
| Público | `GET /locations/cities/:countryCode/:stateCode` | Ciudades. |
| Público | `GET /locations/city/:countryCode/:stateCode/:cityCode` | Detalle de ciudad. |

Los flags de campaña controlan `showProgress`, `showTopBuyers`, `showMinMaxQuota`, `showInstantPrizes`, `showParticipantsDownload`, `showTitleLookup`, `showSocialButtons` y `showCountdown`. El frontend decide si dibuja los elementos visuales; los endpoints sensibles a módulo rechazan la consulta si el administrador no los habilitó.

### Compra, pedidos y pagos

| Acceso | Ruta | Función |
| --- | --- | --- |
| Público / Bearer opcional | `POST /checkout` | Reserva y crea el Pix. Exige `campaignSlug`, `quantity`, datos del comprador, `termsVersion` e `idempotencyKey`; acepta atribución de referidos/UTM. Si hay un Bearer válido, vincula el pedido al usuario. Un Bearer inválido no se ignora. |
| Pedido o titular Bearer | `GET /checkout/:publicId` | Devuelve la vista propietaria del pedido, cuotas y pago asociado. |
| Pedido o titular Bearer | `POST /checkout/:publicId/cancel` | Cancela el cobro todavía pagable y libera la reserva; admite motivo opcional. |
| Pago | `GET /payments/:id` | Consulta segura y acotada del pago para la pantalla Pix. |
| Público | `POST /orders/access/request` | Crea un desafío de recuperación para pedidos de invitado. Siempre devuelve una respuesta equivalente exista o no coincidencia. |
| Público | `POST /orders/access/confirm` | Valida el código, consume el desafío, rota tokens y devuelve los pedidos recuperados. |

La creación devuelve `orderAccessToken` y `paymentAccessSecret`; deben tratarse como credenciales. No deben colocarse en URLs, analítica ni logs. Las reservas y los pagos vencidos se procesan automáticamente cada 30 segundos y el ciclo de las campañas se evalúa cada minuto.

### Participación, premios y resultados

| Acceso | Ruta | Función |
| --- | --- | --- |
| Público | `GET /campaigns/:campaignId/top-buyers` | Ranking limitado con nombre y teléfono enmascarados. |
| Público | `GET /campaigns/:campaignId/min-max-quota` | Menor y mayor título pagado con propietario enmascarado. |
| Público | `GET /campaigns/:campaignId/participants` | Títulos pagados paginados; propietario enmascarado. |
| Público | `GET /campaigns/:campaignId/participants.csv` | CSV público con datos enmascarados y protección contra fórmulas de hoja de cálculo. |
| Público | `GET /campaigns/:campaignId/titles/:number` | Indica si un título está vendido y, si corresponde, muestra propietario enmascarado. |
| Público | `GET /campaigns/:campaignId/prizes` | Premios instantáneos visibles, disponibilidad y ganadores enmascarados. |
| Pedido | `GET /prizes/attempts/order/:orderPublicId` | Intentos de ruleta/raspadinha del pedido; rota y entrega token para intentos pendientes. |
| Premio | `POST /prizes/attempts/:publicId/play` | Consume un intento una sola vez y devuelve resultado y evidencia de la jugada. |
| Pedido | `GET /prize-awards/order/:orderPublicId` | Adjudicaciones del pedido. |
| Pedido | `POST /prize-awards/:publicId/claim` | Reclama una adjudicación del pedido; el cuerpo incluye `orderPublicId`. |
| Público | `GET /campaigns/:campaignIdOrSlug/result` | Resultado publicado de una campaña, o `null` si aún no existe. |
| Público | `GET /results` | Archivo paginado de resultados publicados. |

### Referidos

| Acceso | Ruta | Función |
| --- | --- | --- |
| Público | `GET /referrals/resolve/:code` | Valida vigencia y restricción de campaña sin exponer al beneficiario. Acepta `campaignId`. |
| Público | `POST /referrals/clicks` | Guarda click, visitor/event ID y UTM de forma idempotente, con IP hasheada y rate limit dedicado. |

La atribución de una compra no se expone como endpoint manipulable: el checkout guarda el código/click y `FulfillmentService` crea y aprueba la comisión cuando el proveedor confirma el pago. Una cancelación o reembolso revierte la comisión cuando la política lo permite y se bloquea la autorreferencia de usuarios autenticados.

### Salud operativa

| Acceso | Ruta | Función |
| --- | --- | --- |
| Público | `GET /health/live` | Liveness, versión, timestamp y uptime; no comprueba MongoDB. |
| Público | `GET /health` | Readiness con `ping` real a MongoDB. |
| Público | `GET /health/ready` | Alias de readiness. |

## Funciones del usuario autenticado

### Identidad y sesiones

| Acceso | Ruta | Función |
| --- | --- | --- |
| Público | `POST /auth/register` | Acepta un alta pendiente y devuelve un `registrationId` aleatorio incluso ante colisiones; no emite sesión ni revela identidades existentes. |
| Público | `POST /auth/register/resend` | Exige correo + `registrationId`; solicita otro código solo para el intento vigente, con respuesta antienumeración y cooldown. |
| Público | `POST /auth/register/confirm` | Exige correo + código + `registrationId`; consume el OTP ligado al intento, activa ese mismo intento y emite la primera sesión en una transacción. |
| Público | `POST /auth/login` | Acceso por teléfono y contraseña. |
| Público | `POST /auth/password/reset/request` | Solicita código por teléfono + correo sin revelar si la cuenta existe. |
| Público | `POST /auth/password/reset/confirm` | Valida código, cambia contraseña, verifica el correo e invalida sesiones anteriores. |
| Público | `POST /auth/refresh` | Rota el refresh token y emite nueva sesión. |
| Público | `POST /auth/logout` | Revoca el refresh token enviado. |
| Bearer | `POST /auth/password/change` | Cambia contraseña, incrementa la versión de autenticación e invalida las demás sesiones. |
| Bearer | `GET /auth/me` | Perfil de la sesión actual. |
| Bearer | `PATCH /me/profile` | Actualiza nickname, nombre y dirección propios. |

La activación prueba posesión del correo, no titularidad legal del teléfono o CPF. Estos dos campos solo tienen validación sintáctica; un producto que necesite esa garantía debe integrar OTP por SMS y/o KYC.

### Pedidos, títulos y premios propios

| Acceso | Ruta | Función |
| --- | --- | --- |
| Bearer | `GET /me/orders` | Pedidos propios paginados; filtros por estado y campaña. |
| Bearer | `GET /me/orders/:publicId` | Detalle de un pedido propio. |
| Bearer | `GET /me/titles` | Títulos pagados/adjudicados propios; filtro opcional `campaignId`. |
| Bearer | `GET /me/prize-awards` | Premios adjudicados al usuario. |
| Bearer | `POST /me/prize-awards/:publicId/claim` | Reclama un premio propio. |

### Referidos propios

| Acceso | Ruta | Función |
| --- | --- | --- |
| Bearer | `GET /referrals/me/summary` | Códigos del usuario y resumen de ingresos/comisiones. |
| Bearer | `GET /referrals/me/commissions` | Comisiones paginadas del beneficiario derivado del JWT. |

### Notificaciones

Todas las rutas siguientes requieren Bearer:

| Ruta | Función |
| --- | --- |
| `GET /notifications/push/config` | Indica si Web Push está habilitado y entrega la clave pública VAPID. Aunque el método se denomina configuración pública, el guard del controlador exige sesión. |
| `GET /notifications/me` | Inbox paginado y filtrable. |
| `GET /notifications/me/unread-count` | Cantidad no leída. |
| `PATCH /notifications/:notificationId/read` | Marca una notificación propia como leída. |
| `PATCH /notifications/me/read-all` | Marca todo como leído. |
| `POST /notifications/subscriptions` | Registra o renueva una suscripción/dispositivo. |
| `DELETE /notifications/subscriptions/:subscriptionId` | Desactiva una suscripción propia. |
| `GET /notifications/me/preferences` | Preferencias actuales. |
| `PUT /notifications/me/preferences` | Configura inbox/push, transaccionales/marketing, tipos silenciados y horario de descanso. |

## Funciones de operación y administración

### Campañas, contenido y usuarios

| Acceso | Ruta | Función |
| --- | --- | --- |
| Operación | `POST /admin/campaigns` | Crea campaña en borrador o programada. |
| Operación | `GET /admin/campaigns` | Lista todos los estados, incluidos borrador y cancelada. |
| Operación | `GET /admin/campaigns/:id` | Detalle interno. |
| Operación | `PATCH /admin/campaigns/:id` | Edita configuración; protege campos incompatibles con ventas iniciadas. |
| Operación | `PATCH /admin/campaigns/:id/status` | Transición controlada de estado. |
| Operación | `DELETE /admin/campaigns/:id` | Elimina una campaña cuando las reglas del servicio lo permiten. |
| Operación | `POST /admin/media` | Sube JPEG, PNG, WebP, MP4 o WebM mediante `multipart/form-data` (`file`). |
| Administración | `DELETE /admin/media/:mediaId` | Borrado lógico solo si el medio no tiene referencias. |
| Operación | `POST /categories` | Crea categoría. |
| Operación | `PATCH /categories/:id` | Actualiza categoría. |
| Administración | `DELETE /categories/:id` | Elimina categoría. |
| Administración | `POST /users` | Crea usuario, incluido rol administrativo si lo especifica el DTO. |
| Operación | `GET /users` | Lista usuarios con DTO público, sin hashes de contraseña. |
| Operación | `GET /users/by-phone` | Busca por teléfono. |
| Operación | `GET /users/:id` | Consulta usuario. |
| Administración | `PATCH /users/:id` | Actualiza usuario, rol, estado o contraseña según DTO. |
| Administración | `DELETE /users/:id` | Desactiva el usuario; no borra físicamente el historial. |

Las campañas soportan, entre otros campos, galería ordenada, portada, categoría, estados y fechas, tamaño del espacio numérico, dígitos, precios, compra mínima/máxima, promociones, sugerencias, alternativa en efectivo, método de sorteo, concurso Federal, módulos visibles, ruleta/raspadinha, avisos temporales, doble oportunidad, redes, SEO, IDs de analítica, destacado y orden del catálogo.

### Pedidos y pagos

| Acceso | Ruta | Función |
| --- | --- | --- |
| Operación | `GET /admin/orders` | Pedidos paginados con filtros por estado/campaña y datos operativos. |
| Operación | `GET /admin/orders/campaign/:campaignId/participants.csv` | Exportación administrativa completa. |
| Operación | `POST /payments/admin` | Crea pago manual/operativo; el checkout normal llama el servicio internamente. |
| Operación | `GET /payments/admin` | Pagos paginados, con filtro de estado. |
| Operación | `GET /payments/admin/:id` | Vista operativa completa. |
| Operación | `POST /payments/admin/:id/reconcile` | Consulta el proveedor y concilia el estado. |
| Operación | `POST /payments/admin/:id/retry-lifecycle` | Reintenta callbacks internos idempotentes de pedido, premio, referido y notificación. |
| Operación | `POST /payments/admin/:id/cancel` | Cancela una cobranza pagable. |
| Administración | `POST /payments/admin/:id/refund` | Solicita devolución Pix total o parcial con política de protección de premios entregados. |
| Administración | `PATCH /payments/admin/:id/status` | Transición manual auditada con motivo. |
| PSP | `POST /payments/webhooks/:provider` | Webhook idempotente del proveedor. |
| PSP | `POST /payments/webhooks/:provider/pix` | Alias Pix del webhook. |

En producción el proveedor esperado es Efí Pix con OAuth y certificado cliente. El webhook acepta el secreto solo por cabecera `x-efi-webhook-token`; no lo lee de la query string. Puede exigir además la señal mTLS del proxy.

### Sorteos y publicación de resultados

Todas estas rutas requieren rol `operator` o `admin`:

| Ruta | Función |
| --- | --- |
| `POST /admin/campaigns/:campaignId/draw/cryptographic/commit` | Publica el compromiso SHA-256 antes de abrir ventas. |
| `POST /admin/campaigns/:campaignId/draw/verify/federal-lottery` | Obtiene y concilia dos lecturas del concurso oficial de Lotería Federal CAIXA; el número principal se deriva en servidor de la regla fijada en la campaña. |
| `POST /admin/campaigns/:campaignId/draw/verify/manual-external` | Registra número y evidencia externa manual. |
| `POST /admin/campaigns/:campaignId/draw/verify/cryptographic` | Revela secreto, valida compromiso y combina entropía externa. |
| `POST /admin/campaigns/:campaignId/draw/publish` | Publica un resultado verificado y notifica al ganador autenticado. |
| `GET /admin/campaigns/:campaignId/draw` | Vista de auditoría con evidencia íntegra. |

Un resultado solo se verifica cuando la campaña está agotada/lista para sorteo y el 100 % de los títulos está vendido. Una vez publicado es inmutable a nivel de esquema. En el método Federal, el concurso debe quedar fijado antes de activar ventas; el adaptador solo admite el endpoint HTTPS oficial permitido, rechaza redirecciones, limita tiempo/tamaño, valida el JSON y exige que ambas lecturas normalizadas coincidan. Se conservan hashes SHA-256 y evidencia operativa.

### Premios instantáneos

| Acceso | Ruta | Función |
| --- | --- | --- |
| Operación | `POST /admin/prizes` | Crea premio por título ganador, ruleta o raspadinha, con stock, peso, efectivo/alternativa y medio. |
| Operación | `PATCH /admin/prizes/:id` | Actualiza el premio respetando adjudicaciones existentes. |
| Operación | `DELETE /admin/prizes/:id` | Elimina o cancela según su historial. |
| Operación | `POST /admin/prizes/awards/:publicId/fulfill` | Marca como entregado un premio previamente reclamado. |

### Configuración versionada

| Acceso | Ruta | Función |
| --- | --- | --- |
| Operación | `GET /admin/settings` | Lista versiones y estados. |
| Operación | `GET /admin/settings/:version` | Consulta una versión. |
| Administración | `POST /admin/settings` | Crea un borrador nuevo. |
| Administración | `PATCH /admin/settings/:version` | Edita un borrador. |
| Administración | `POST /admin/settings/:version/publish` | Publica una versión. |
| Administración | `DELETE /admin/settings/:version` | Archiva una versión no vigente sin borrar el historial. |

### Referidos y notificaciones

| Acceso | Ruta | Función |
| --- | --- | --- |
| Operación | `POST /admin/referrals/codes` | Crea código generado o personalizado, beneficiario, tasa, vigencia, campaña y máximo de conversiones. |
| Operación | `GET /admin/referrals/codes` | Lista códigos con filtros. |
| Operación | `PATCH /admin/referrals/codes/:codeId` | Edita, pausa o desactiva. |
| Operación | `GET /admin/referrals/clicks` | Clicks y UTM. |
| Operación | `GET /admin/referrals/commissions` | Atribuciones y comisiones. |
| Administración | `PATCH /admin/referrals/commissions/:commissionId/status` | Aprueba, paga, rechaza o revierte comisión. |
| Operación | `POST /admin/notifications` | Crea notificación de un usuario y opcionalmente intenta push. |
| Operación | `POST /admin/notifications/:notificationId/deliver` | Reintenta entrega push. |

### Auditoría

| Acceso | Ruta | Función |
| --- | --- | --- |
| Operación | `GET /admin/audit-logs` | Consulta paginada y filtrable. |
| Operación | `GET /admin/audit-logs/export.csv` | Exporta hasta el límite operativo configurado. |
| Operación | `GET /admin/audit-logs/:id` | Detalle de evento. |

El interceptor global registra automáticamente mutaciones y lecturas administrativas sensibles con actor, rol, recurso, resultado, IP, user-agent, duración y correlation ID. Los campos con nombres sensibles se redactan y el esquema de auditoría rechaza actualizaciones o borrados: es append-only.

## Módulos internos sin página o endpoint propio

| Módulo | Responsabilidad |
| --- | --- |
| `FulfillmentModule` | Reacciona a pagos: confirma/libera pedidos, adjudica o revierte premios, atribuye/revierte referidos y genera notificaciones. |
| `TasksModule` | Actualiza automáticamente el ciclo de campañas. |
| Tareas programadas de órdenes/checkout | Liberan reservas y vencen pagos periódicamente. |
| `EmailModule` | SMTP y códigos usados internamente por recuperación de contraseña y de pedidos. Su `EmailController` no está registrado, por lo que `/email/send-code` y `/email/verify-code` no son rutas activas. |

Aunque hay código fuente para `ProductsModule`, `TransactionsModule` y `WinnersModule`, esos módulos no están importados por `AppModule`. Sus controladores no forman parte de la API activa y no deben usarse como contrato web.

## Seguridad y privacidad

- Validación global con transformación, lista blanca y rechazo de campos no declarados.
- Rate limit global y límites más estrictos para registro, login, checkout, recuperación de contraseña, recuperación de pedidos y clicks de referidos.
- Contraseñas con bcrypt (coste 12), bloqueo temporal tras intentos fallidos y comparación de tiempo constante para credenciales heredadas.
- El registro público permanece inactivo hasta verificar el correo. Sus respuestas no enumeran teléfono, CPF ni email; los OTP tienen propósito, caducidad explícita, cooldown, máximo de intentos y consumo transaccional de un solo uso.
- JWT con issuer, audience, expiración y `authVersion`; refresh tokens opacos hasheados, rotados y agrupados en familias para detectar reutilización.
- Roles `customer`, `operator` y `admin`; los guards están aplicados en los controladores, no se confía en un rol enviado por el cliente.
- Pedidos de invitado, pagos y jugadas usan tokens opacos; se guarda su hash, no el token recuperable.
- La recuperación de pedidos usa un secreto HMAC dedicado, TTL de 15 minutos, máximo de intentos, cooldown por identidad hasheada, consumo de un solo uso, límite de pedidos y respuesta antienumeración. Si se supera el límite devuelve `ORDER_ACCESS_CAMPAIGN_REQUIRED` tras validar el código, para repetir la solicitud con `campaignId` sin truncar silenciosamente resultados.
- Reservas, asignación de títulos, publicación de resultados, premios y recuperaciones sensibles usan transacciones de MongoDB; por ello se exige replica set.
- Checkout, pagos, webhooks y clicks incorporan idempotencia para evitar duplicados por reintentos.
- Los precios, promociones, cantidades bonus y elegibilidad se recalculan en servidor; el importe del navegador no es fuente de verdad.
- Cada pedido conserva versión, hash y fecha de aceptación del reglamento.
- La participación pública y los resultados enmascaran nombre/teléfono; el CSV administrativo completo exige rol. Las vistas públicas eliminan IDs/campos internos de asignación y evidencia privada.
- El webhook Efí se protege con cabecera HMAC y/o mTLS, con comparación de tiempo constante; los secretos no se admiten en la URL.
- Los uploads validan MIME y firma binaria, tamaño, nombre, rutas y traversal; se sirven con `nosniff`, ETag y tipos permitidos. Los medios referenciados no pueden borrarse.
- Helmet, CORS de orígenes explícitos, compresión y correlation IDs están configurados en el proceso HTTP. TLS debe terminarse en la infraestructura frontal.
- El contenedor de producción corre sin root, con filesystem de solo lectura, capacidades eliminadas, secretos/certificados en volúmenes de solo lectura y almacenamiento persistente separado.

## Dependencias externas

| Dependencia | Necesidad | Uso |
| --- | --- | --- |
| MongoDB 7 en replica set | Obligatoria | Persistencia, índices únicos y transacciones de pedidos, premios, resultados y recuperación. Debe tener autenticación, volumen y backups. |
| Efí Pix | Obligatoria para pagos Pix reales | OAuth, creación/consulta/cancelación/devolución de cobros, QR y webhook. Requiere credenciales, clave Pix y certificado cliente. El proveedor `mock` es solo para desarrollo/pruebas. |
| SMTP | Obligatoria en la validación de producción | Códigos de recuperación de contraseña y pedidos invitados. |
| Portal de Loterías CAIXA | Obligatoria para campañas con método Federal; su URL también se valida en producción | Verificación oficial de concurso Federal mediante dos lecturas. Si CAIXA no responde o cambia el contrato, la verificación falla cerrada y requiere intervención, no inventa un resultado. |
| Servicios Web Push del navegador | Opcional | Entrega mediante VAPID a hosts permitidos de Google, Mozilla, Apple o Windows. Sin configuración, el proveedor queda en modo `noop` y el inbox sigue funcionando. |
| Volumen de medios local | Obligatorio con la configuración actual | Imágenes y videos. El backend implementa proveedor local; CDN/object storage no está implementado como proveedor activo. |
| Proxy/edge con HTTPS | Obligatorio en Internet | Certificado TLS, dominio, forwarding correcto de IP/protocolo y, si se usa, validación mTLS de Efí. El Nginx incluido escucha HTTP interno y está pensado para ir detrás del terminador TLS. |
| Meta Pixel / Google Tag Manager | Opcional y frontend | El backend guarda IDs por campaña; la web decide si carga scripts tras aplicar consentimiento. |

## Qué corresponde exclusivamente al frontend

El frontend es responsable de:

- Reproducir el diseño visual: estructura, tipografía, colores, botones, tarjetas, hero, carrusel, modales, responsive y animaciones.
- Implementar rutas de navegación como inicio, campaña, checkout, pago, mis títulos, resultados, login, cuenta y panel.
- Renderizar el selector de cantidad y mostrar la cotización del servidor sin recalcularla como verdad definitiva.
- Mostrar QR/copia y pega, botón de copiar, contador de expiración y polling prudente del pedido/pago.
- Guardar los tokens opacos de manera segura para el flujo invitado y limpiar credenciales cuando dejan de ser necesarias; nunca enviarlos a analítica ni ponerlos en query strings.
- Implementar formularios, estados de carga, errores, accesibilidad, internacionalización y máscaras visuales de CPF/teléfono.
- Dibujar avance, countdown, rankings, tabla/CSV, ruleta o raspadinha. El resultado de un juego lo decide el backend; la animación solo lo representa.
- Generar metadatos HTML/SSR, Open Graph, canonical, sitemap y JSON-LD usando los campos SEO entregados por la campaña.
- Implementar manifest, service worker, prompt de instalación PWA y permiso/suscripción Push. El backend solo entrega configuración y guarda la suscripción.
- Ejecutar Web Share o enlaces de WhatsApp/Telegram/Instagram. El backend aporta contactos y flags, pero no controla las aplicaciones sociales.
- Cargar Meta Pixel/GTM con consentimiento y configurar la medición del lado cliente.
- Construir las páginas estáticas o editoriales que no tienen modelo dedicado, por ejemplo FAQ, “cómo funciona” o contenido institucional adicional. Contacto y legal básico sí pueden obtenerse de settings.
- Construir el backoffice visual. Todas las operaciones existen como API, pero no hay panel HTML incluido en este proyecto.

No existen actualmente WebSockets/SSE para tiempo real: la web debe actualizar progreso, pedido y resultados mediante refresco/polling o caché invalidada. Tampoco hay envío directo por SMS o WhatsApp; los enlaces sociales son frontend y los códigos operativos se entregan por SMTP.

## Checklist mínimo de producción

### Infraestructura y secretos

- [ ] Usar Node.js 20 y `pnpm` con lockfile; construir la etapa `production` del `Dockerfile`.
- [ ] Generar `.env.server` con `./setup-env.sh`, completar valores reales, mantener modo `0600` y no versionarlo.
- [ ] Configurar secretos distintos y de al menos 32 caracteres para JWT, correo, checkout, recuperación de pedidos, pagos y hash de referidos. `ORDER_ACCESS_CODE_SECRET` es obligatorio y dedicado en producción.
- [ ] Configurar MongoDB autenticado en replica set y una URI con `replicaSet`, `retryWrites=true` y escritura majority.
- [ ] Probar backup, restauración y retención de MongoDB; respaldar también el volumen de medios.
- [ ] Terminar HTTPS en el edge, restringir los puertos internos a loopback/red privada, activar `TRUST_PROXY` solo detrás del proxy y configurar `CORS_ORIGINS` sin comodines.
- [ ] Mantener Swagger deshabilitado o protegido en producción.

### Pagos, correo y resultados

- [ ] Usar `PAYMENTS_PROVIDER=efi` y `PAYMENTS_ALLOW_MOCK=false`.
- [ ] Instalar credenciales, clave Pix y certificado Efí con permisos privados; verificar sandbox antes de producción.
- [ ] Registrar en Efí el webhook correcto y configurar `EFI_WEBHOOK_HMAC` o mTLS; comprobar pago, duplicado de webhook, expiración, cancelación, conciliación y devolución.
- [ ] Configurar SMTP con TLS y remitente válido; probar recuperación de contraseña y de pedidos, incluidos rebotes/fallos sin enumeración.
- [ ] Mantener `CAIXA_FEDERAL_API_BASE_URL` en el endpoint HTTPS oficial permitido y autorizar salida de red; ensayar una verificación real antes del primer sorteo Federal.
- [ ] Fijar el concurso Federal y la regla de cálculo antes de activar ventas; no cambiar el espacio de títulos ni la regla después de vender.

### Web, medios y notificaciones

- [ ] Montar el volumen persistente de medios y verificar límites de subida, espacio libre y restauración.
- [ ] Configurar VAPID y hosts permitidos si se desea Push; en caso contrario mantener `NOTIFICATION_PUSH_PROVIDER=noop` conscientemente.
- [ ] Probar el frontend con usuario y como invitado: checkout idempotente, pérdida/recuperación de token, pago confirmado, títulos, premio, cancelación y expiración.
- [ ] Aplicar una política de cookies/consentimiento antes de cargar Pixel o GTM y evitar PII/tokens en analytics y logs del navegador.
- [ ] Revisar textos legales, CNPJ/responsable, reglamento versionado, política de privacidad y condiciones con asesoría aplicable al negocio.

### Verificación y operación

- [ ] Ejecutar `pnpm lint:check`, `pnpm build`, pruebas unitarias y `pnpm test:e2e` contra un MongoDB replica set.
- [ ] Ejecutar `./deploy-prod.sh --check` antes de desplegar y comprobar `GET /api/v1/health/live` y `GET /api/v1/health` después.
- [ ] Configurar alertas por errores 5xx, fallos SMTP/Efí/CAIXA, espacio de disco, MongoDB y colas de pagos pendientes/en revisión.
- [ ] Centralizar logs sin query strings sensibles, conservar `X-Correlation-Id` y revisar periódicamente `/admin/audit-logs`.
- [ ] Documentar runbooks para caída de Efí, caída/cambio de CAIXA, webhook retrasado, devolución, disputa, recuperación de backup y entrega manual de premio.

## Alcance final

Con esta API puede construirse una web funcionalmente equivalente y visualmente idéntica a la referencia, siempre que se desarrolle el frontend y se conecten las dependencias reales. El backend es la fuente de verdad transaccional y aporta los contratos necesarios; no sustituye el diseño web, la contratación/configuración de Efí y SMTP, la infraestructura TLS/backup/monitorización ni la revisión legal de la operación.
