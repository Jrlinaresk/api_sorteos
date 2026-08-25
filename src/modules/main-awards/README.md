# Premio principal y entrega

El contrato del premio principal se crea al publicar el resultado y solo puede
consultarlo el propietario real del pedido ganador, mediante Bearer o
`X-Order-Token`. `GET /api/v1/me/main-awards` lista de forma paginada los premios
de todos los pedidos que actualmente pertenecen a la cuenta, incluidos los que
se compraron como invitado y se vincularon después.

`POST /api/v1/main-awards/:publicId/claim` recibe:

- `choice: "cash"`: no requiere datos logísticos y solo está disponible cuando
  el contrato conserva una alternativa monetaria positiva.
- `choice: "physical"`: exige `delivery.recipientName`, `delivery.phone` y
  `delivery.address`; `delivery.instructions` es opcional.

Los datos se normalizan y persisten una sola vez. Repetir el reclamo con la
misma elección y exactamente los mismos datos es idempotente; cambiar elección
o entrega produce conflicto. `deliveryDetails` usa `select: false`: nunca sale
en resultados públicos ni en listados administrativos. El propietario lo ve en
su vista privada y el administrador únicamente en el detalle operativo del
premio, donde se necesita para la entrega.
