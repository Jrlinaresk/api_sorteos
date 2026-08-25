# Pedidos y recuperación de acceso

Los compradores autenticados consultan sus pedidos en `GET /api/v1/me/orders`.
Un comprador invitado recibe `X-Order-Token` al completar el checkout y lo usa
para consultar un pedido individual. Si pierde ese token, puede recuperar todos
sus pedidos coincidentes sin exponerlos mediante búsquedas públicas:

1. `POST /api/v1/orders/access/request` recibe `phone`, `email` y un
   `campaignId` opcional. Siempre responde `202` con un `challengeId` opaco y el
   mismo mensaje, exista o no una coincidencia.
2. Si existen pedidos de invitado coincidentes, el código de seis dígitos se
   envía por SMTP sin bloquear la respuesta HTTP.
3. `POST /api/v1/orders/access/confirm` recibe `challengeId`, `code` y el booleano
   opcional `linkToAccount` (por defecto `false`). Un código válido consume el
   challenge, rota todos los tokens en una transacción MongoDB y devuelve cada
   vista privada junto con su nuevo `accessToken`.
4. Con `linkToAccount: true`, el endpoint exige un Bearer válido con rol
   `customer` y, dentro de la misma transacción, asigna los pedidos y sus títulos
   a esa cuenta. Desde entonces el Bearer sustituye al token en pedidos,
   intentos y premios, aunque estos se hubieran creado originalmente como
   invitado.

`GET /api/v1/me/orders` acepta `page`, `limit`, `status`, `campaignId` y
`search`. La búsqueda se limita a los pedidos del usuario y cubre ID público y
snapshot del comprador. La respuesta incluye `meta.pages` y
`meta.hasNextPage`.

Los challenges caducan a los 15 minutos y admiten como máximo cinco intentos.
Además del límite HTTP por IP, `identityHash` aplica en MongoDB un cooldown por
teléfono, correo y campaña sin persistir esos datos dentro del challenge. Una
solicitud repetida durante el cooldown reutiliza el mismo challenge y no vuelve
a enviar correo.

La solicitud global lee como máximo `ORDER_ACCESS_MAX_ORDERS + 1`. Si prueba que
existen más pedidos que el máximo, `confirm` consume el challenge sin rotar un
subconjunto y devuelve `ORDER_ACCESS_CAMPAIGN_REQUIRED` con `meta.hasMore=true`.
Solo después de validar correctamente el código, la respuesta incluye en
`meta.campaigns` las campañas realmente asociadas a esa identidad, incluidas
campañas cerradas o canceladas. El cliente debe pedir otro código indicando uno
de esos `campaignId`; no necesita ni debe consultar el catálogo público para
descubrirlos.

Una recuperación limitada a una campaña admite hasta el máximo absoluto de 50
pedidos, independientemente del límite global configurable. Si esa misma
campaña supera 50, el challenge se consume sin rotar un subconjunto y se
devuelve `ORDER_ACCESS_SUPPORT_REQUIRED`; el cliente debe mostrar el canal de
soporte en vez de repetir un selector que nunca podría completar la operación.
Los identificadores de campañas verificados se almacenan con `select: false`,
igual que el código y los IDs de pedido, para que ninguna consulta ordinaria los
exponga.

Configuración:

- `ORDER_ACCESS_CODE_SECRET`: secreto HMAC independiente de al menos 32
  caracteres; obligatorio en producción.
- `ORDER_ACCESS_MAX_ORDERS`: máximo transaccional entre 1 y 50; valor por
  defecto `20`.
- `ORDER_ACCESS_REQUEST_COOLDOWN_SECONDS`: cooldown persistente entre 30 y 3600
  segundos; valor por defecto `60`.
- `ORDER_ACCESS_TOKEN_HOURS`: validez del token opaco rotado, entre 1 y 168
  horas; valor por defecto `24`. Un pedido vinculado a una cuenta deja de
  aceptar ese bearer alternativo y exige el JWT del propietario.

Nunca se registran códigos, hashes ni datos personales. `codeHash`,
`identityHash`, `orderIds` y la marca de truncamiento están excluidos de las
consultas MongoDB normales mediante `select: false`.
