# Integración del módulo de autenticación

Importar `AuthModule` en el módulo raíz y definir estas variables:

```env
JWT_SECRET=un-secreto-aleatorio-de-al-menos-32-caracteres
JWT_ACCESS_EXPIRES_IN=15m
JWT_ISSUER=api-sorteos
JWT_AUDIENCE=sorteos-web
```

`JWT_SECRET` no tiene valor predeterminado: la aplicación se detiene si falta o
es demasiado corto.

Para que Swagger muestre el botón de autorización, añadir
`.addBearerAuth()` al `DocumentBuilder`.

## Endpoints

- `POST /auth/register`: acepta un alta pública pendiente; nunca devuelve
  usuario, access token ni refresh token.
- `POST /auth/register/resend`: vuelve a solicitar el código con respuesta
  genérica.
- `POST /auth/register/confirm`: consume el código, activa la cuenta y recién
  entonces entrega la primera sesión.
- `POST /auth/login`: devuelve un access token Bearer.
- `GET /auth/me`: devuelve el usuario autenticado.
- `POST /auth/password/reset/request`: solicita un código sin revelar si la
  cuenta existe.
- `POST /auth/password/reset/confirm`: consume el código, establece el nuevo
  hash y devuelve una sesión.

Los usuarios históricos con contraseña se migran a bcrypt al primer login. Los
que nunca tuvieron contraseña deben usar el restablecimiento por correo.

## Contrato del alta pública

Un `POST /auth/register` sintácticamente válido devuelve siempre HTTP `202`:

```json
{
  "registrationId": "7F0i_dQ8JjY-yVxYQwA2eKp4Rb1z9N3uHc6LmTsXoPE",
  "message": "Si los datos pueden registrarse, recibirás un código de verificación por correo",
  "verificationRequired": true
}
```

La respuesta es idéntica si teléfono, CPF o correo ya pertenecen a otra cuenta.
Incluso una colisión con una cuenta activa recibe un `registrationId` aleatorio
de 256 bits y con el mismo formato. El navegador debe conservarlo únicamente
durante este flujo y enviarlo junto con el correo tanto a
`/auth/register/resend` como a `/auth/register/confirm`.

Una repetición exacta de un alta aún pendiente **reemplaza** contraseña, nombre,
nickname y `registrationId`. El intento y OTP anteriores quedan invalidados.
Esto impide que quien pre-registró datos ajenos consiga que el titular del correo
active la contraseña anterior: una carrera posterior puede invalidar el flujo y
obligar a reiniciarlo, pero nunca activar credenciales de otro intento. El
endpoint `/auth/register/resend` exige el `registrationId` vigente y también
responde `202` aunque no coincida con un alta pendiente.

Las altas nuevas se guardan con `isActive=false`, `emailVerified=false` y una
marca interna `registrationPending=true`. Vencen a las 24 horas; al colisionar
con una nueva solicitud, una reserva pendiente vencida puede sustituirse de
forma condicional. Mientras esté pendiente, login, refresh, validación JWT y
recuperación de contraseña la rechazan con el mismo error genérico que una
cuenta inexistente o inactiva.

Los códigos tienen seis dígitos, vencen a los 15 minutos por comparación
explícita de `expiresAt`, admiten como máximo cinco intentos y tienen un cooldown
de un minuto. El índice TTL es solo limpieza; no se usa como control de
caducidad. Cada código queda ligado criptográficamente a su propósito
(`registration` o `password_reset`) y, en el registro, al `registrationId`
vigente. El usuario almacena únicamente SHA-256 del identificador y el OTP usa
HMAC. Un código del intento A no puede activar el intento B. La confirmación
consume el código y activa el usuario filtrando el mismo intento, en una única
transacción MongoDB.

### Alcance de la verificación de identidad

El factor de activación implementado es la posesión del correo indicado. El
teléfono solo se normaliza y valida por formato, y el CPF por formato y dígitos
verificadores; este flujo **no demuestra** que quien controla el correo sea el
titular legal del teléfono o del CPF. Si el producto necesita esa garantía,
debe añadir OTP por SMS y/o un proveedor KYC antes de tratar esos campos como
identidad verificada.

### Compatibilidad al desplegar

- Usuarios existentes sin `registrationPending` se consideran cuentas
  históricas normales; no se desactivan ni se obliga una verificación retroactiva.
- Los códigos emitidos antes de esta versión no tienen propósito ni `expiresAt`
  explícitos y dejan de ser válidos. El usuario debe solicitar uno nuevo.
- Cualquier alta pendiente creada por una versión sin `registrationIdHash`
  debe reiniciar `POST /auth/register`; la repetición exacta la actualiza.
- Con `MONGODB_AUTO_INDEX=true`, Mongoose crea el índice TTL de `expiresAt` y el
  índice de búsqueda de altas pendientes al arrancar. Si los índices se
  administran externamente, deben aplicarse antes de desactivar `autoIndex`.

Los controladores administrativos deben usar:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```

Al desplegar sobre una base existente, verificar/recrear los índices únicos
`phone`, `cpf` y `email`; estos dos últimos deben ser `sparse`.
