# Checkout público

`CheckoutModule` orquesta el motor transaccional de `OrdersModule` con
`PaymentsModule`. No recibe importes del navegador: primero reserva las cuotas y
usa exclusivamente `Order.total`, calculado por el backend, para crear el Pix.
La ruta rechaza propiedades no declaradas como `amount`, `price` o `provider`.

## Rutas

- `POST /api/v1/checkout`: reserva cuotas y crea/asocia el cobro. Requiere
  un `idempotencyKey` aleatorio de 24-128 caracteres y devuelve
  `orderAccessToken`, `paymentAccessSecret`, estado, QR y Pix copia/pega.
- `GET /api/v1/checkout/:publicId`, con `X-Order-Token`: consulta privada del
  pedido y su pago saneado.
- `POST /api/v1/checkout/:publicId/cancel`, con `X-Order-Token`: cancela el cobro
  todavía pagable y libera la reserva.

El módulo debe importarse finalmente en `AppModule`; esta tarea lo deja aislado
porque la integración del módulo raíz está coordinada por el agente principal.
El propio módulo inicializa el scheduler que expira pagos y reservas.

## Consistencia e idempotencia

La reserva de cuotas conserva la transacción MongoDB existente. El proveedor de
pagos es externo y no puede formar parte de esa transacción, por lo que el flujo
usa una saga compensatoria:

1. reserva cuotas atómicamente;
2. crea el Pix con un `txid` determinista;
3. asocia el pago al pedido de forma idempotente;
4. ante un timeout intenta conciliar; si no existe un cobro utilizable, libera la
   reserva;
5. si falla la asociación, intenta cancelar el Pix y libera la reserva.

`CHECKOUT_ACCESS_SECRET_KEY` genera tokens deterministas y secretos para replays
idempotentes concurrentes. Es obligatorio en producción (puede reutilizarse
`PAYMENTS_PUBLIC_SECRET_KEY`, aunque se recomienda una clave distinta).

## Hooks posteriores

`PaymentsService.registerLifecycleHooks()` admite múltiples consumidores. Este
módulo registra los callbacks de pedidos:

- pago confirmado: convierte cuotas reservadas en pagadas;
- revisión/disputa/rechazo: marca el pedido para revisión;
- cancelación/expiración: libera las cuotas;
- devolución total: marca pedido y cuotas como reembolsados.

Premios instantáneos, notificaciones y referidos deben registrar listeners
adicionales e idempotentes usando `paymentId` como clave, sin reemplazar el
listener de checkout.
