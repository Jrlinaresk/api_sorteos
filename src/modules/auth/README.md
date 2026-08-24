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

- `POST /auth/register`: crea siempre un usuario `customer`.
- `POST /auth/login`: devuelve un access token Bearer.
- `GET /auth/me`: devuelve el usuario autenticado.
- `POST /auth/password/reset/request`: solicita un código sin revelar si la
  cuenta existe.
- `POST /auth/password/reset/confirm`: consume el código, establece el nuevo
  hash y devuelve una sesión.

Los usuarios históricos con contraseña se migran a bcrypt al primer login. Los
que nunca tuvieron contraseña deben usar el restablecimiento por correo.

Los controladores administrativos deben usar:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```

Al desplegar sobre una base existente, verificar/recrear los índices únicos
`phone`, `cpf` y `email`; estos dos últimos deben ser `sparse`.
