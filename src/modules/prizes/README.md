# Premios instantáneos verificables

El plan de premios solo se puede crear, editar o borrar mientras la campaña
está en `draft` y no existen pedidos, intentos, adjudicaciones ni inventario ya
consumido. Al publicarse la campaña, títulos objetivo, stock, pesos y orden
quedan congelados.

## Compromiso de cada intento

Al confirmar el pago se persiste un snapshot `version: 1` con:

- la mecánica (`roulette` o `scratch`);
- `noPrizeWeight`, incluso cuando vale cero;
- todos los premios de esa mecánica, ordenados por `sortOrder` y luego por ID,
  incluidos los de peso cero;
- ID, peso, stock configurado y orden de cada premio.

El JSON canónico siempre usa las claves en este orden:

```text
version, mechanic, noPrizeWeight, prizes
prizeId, weight, stock, sortOrder
```

Se calculan los siguientes SHA-256 hexadecimales sobre UTF-8:

```text
configurationHash = SHA256(canonicalSnapshotJson)
entropyCommitment = SHA256(entropyReveal:configurationHash:attemptPublicId)
resultDigest = SHA256(entropyReveal:attemptPublicId:configurationHash)
```

Antes de jugar se publican `configurationHash` y `entropyCommitment`, pero no el
snapshot ni `entropyReveal`. Después de jugar se entregan ambos para que el
cliente pueda recomputar la prueba.

## Selección e inventario

Los primeros 52 bits de `resultDigest` se convierten en un valor uniforme en
`[0, 1)`. Este valor se multiplica por la suma determinista de `noPrizeWeight` y los
pesos comprometidos. El primer intervalo corresponde a "sin premio" y los
siguientes respetan el orden canónico del snapshot.

La adjudicación usa un `findOneAndUpdate` transaccional condicionado a estado
activo y `awardedCount < stock`. Si otro intento agotó el premio elegido, el
intento persiste `outcome: inventory_exhausted`, termina sin adjudicación y no
se vuelve a sortear: así no se altera el resultado comprometido ni se
sobreasigna inventario.

Juego, reclamación y entrega escriben un cerrojo de ciclo de vida en el pedido
pagado dentro de la misma transacción. Esto los serializa con el cambio de
estado del pedido durante un reembolso. Los intentos pendientes expiran y las
adjudicaciones se revierten al confirmar el reembolso.

## Acceso del propietario

Los endpoints de intentos y adjudicaciones por pedido aceptan
`X-Order-Token` para invitados o Bearer para el propietario actual del pedido.
`POST /prizes/attempts/:publicId/play` aplica la misma regla con
`X-Prize-Token`. La propiedad se verifica contra el pedido, no contra el
snapshot opcional del intento/premio; por eso una compra invitada sigue
apareciendo y puede jugarse después de vincularla a una cuenta.
