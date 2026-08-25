# Panel administrativo monolítico

El panel es una SPA React + TypeScript integrada en este mismo paquete NestJS.
No es otro proyecto ni otro despliegue:

```text
navegador ── /admin ──────┐
                          ├── mismo proceso Nest, misma imagen Docker
navegador ── /api/v1 ─────┘
```

Vite genera `dist/admin` y `configureAdminPanel` sirve tanto los assets
versionados como el fallback de rutas de la SPA. `ADMIN_PANEL_ENABLED=false`
permite apagar únicamente la interfaz sin desactivar la API.

## Desarrollo y producción

```bash
# selecciona la versión fijada en .nvmrc
nvm install
nvm use

# Nest con watch + Vite con HMR
pnpm start:dev

# artefacto completo que usa Docker/producción
pnpm build
pnpm start:prod
```

- Desarrollo: `http://localhost:5173/admin/` y API proxy a
  `http://127.0.0.1:8080/api/v1`.
- Producción: `https://SU-DOMINIO/admin` y `/api/v1` en el mismo origen.
- Las rutas internas, por ejemplo `/admin/orders/:publicId`, vuelven a
  `index.html`; por eso funcionan también al recargar el navegador.
- El HTML usa `Cache-Control: no-store`; los assets con hash usan cache
  inmutable de un año y todas las rutas del panel llevan `X-Robots-Tag`.
- El build no publica sourcemaps y comprueba TypeScript antes de generar Vite.
- Con el panel habilitado, producción aborta el arranque si falta
  `dist/admin/index.html`, evitando un health check verde sin interfaz.
- `pnpm start:prod` fija `NODE_ENV=production`; no carga configuración de
  desarrollo por accidente.

Para crear el primer administrador dentro del despliegue Docker, use el comando
one-off documentado en [README.md](./README.md#desarrollo-local-del-monolito).
Las variables `BOOTSTRAP_ADMIN_*` no se guardan en el servicio permanente.

## Seguridad de sesión y roles

`POST /api/v1/admin/session/login` reutiliza la autenticación del backend pero
rechaza cualquier cuenta distinta de `operator` o `admin`. El access token corto
se mantiene solo en memoria. El refresh token se rota en una cookie `HttpOnly`,
`SameSite=Strict`, restringida a `/api/v1/admin/session` y marcada `Secure` en
producción. Al recargar, el panel recupera la sesión mediante esa cookie. Las
rutas de sesión exigen además `X-Admin-Session: browser`. En producción,
`ADMIN_PANEL_ORIGINS` es obligatorio y constituye la única lista de confianza;
no se infiere desde `Host`, porque un proxy puede servir también el portal
cliente. Esa lista nunca debe contener el origen del portal de clientes.

El frontend oculta las acciones no autorizadas, pero la seguridad definitiva
sigue en guards y roles de Nest:

| Capacidad                                               | Operator | Admin |
| ------------------------------------------------------- | :------: | :---: |
| Consultar dashboard, campañas, pedidos y pagos          |    Sí    |  Sí   |
| Crear/editar campañas y operar premios instantáneos     |    Sí    |  Sí   |
| Conciliar/reintentar/cancelar pagos                     |    Sí    |  Sí   |
| Reembolsar o forzar estado financiero                   |    No    |  Sí   |
| Verificar sorteo Federal/criptográfico                  |    Sí    |  Sí   |
| Verificación manual y publicación final                 |    No    |  Sí   |
| Gestionar usuarios, auditoría y configuración publicada |    No    |  Sí   |
| Borrado/purga de medios y premio principal              |    No    |  Sí   |

## Módulos incluidos

- **Resumen:** ventas por periodo, ingreso neto, campañas activas, usuarios,
  excepciones operativas, ranking y pedidos recientes.
- **Campañas:** búsqueda, filtros, paginación, alta/edición, máquina de estados,
  prórroga de vencidas, eliminación segura y configuración de venta/sorteo.
- **Pedidos:** búsqueda por comprador o identificador, estado, campaña, detalle
  administrativo, cuotas y descarga CSV de participantes.
- **Pagos:** listado y detalle Pix, historial, conciliación, reintento del
  lifecycle, cancelación y controles exclusivos para refund/estado manual.
- **Sorteos:** campañas listas, commit criptográfico, verificación Federal,
  manual o criptográfica, evidencia y publicación con separación de actores.
- **Premios:** definiciones instantáneas, adjudicaciones, entregas y premios
  principales.
- **Referidos:** códigos, clicks, comisiones y cambios de estado financieros.
- **Notificaciones:** historial, creación, entrega y reintento con advertencia
  para resultados inciertos.
- **Biblioteca:** subida de imagen/video, uso de almacenamiento, soft delete y
  purga definitiva por retención.
- **Categorías, usuarios y configuración:** catálogos, cuentas/roles y versiones
  publicables del sitio.
- **Auditoría:** filtros, detalle técnico y exportación CSV solo para admin.

## Acciones críticas

El panel exige confirmaciones explícitas en acciones irreversibles o monetarias.
No sustituye las invariantes del servidor: las devoluciones usan clave de
idempotencia, una campaña no llega a `drawn` por el endpoint genérico y el
resultado solo se publica después de conciliación, venta cerrada y verificación
por una identidad distinta.

Los errores muestran su `X-Correlation-Id` cuando está disponible, para cruzarlos
con logs y auditoría sin exponer payloads sensibles.

## Límites conocidos del dominio

La interfaz administra todo lo que hoy expone el backend, pero no inventa
capacidades que todavía no existen: no ejecuta transferencias bancarias de
comisiones/premios, no restaura medios purgados, no revierte premios entregados,
no programa campañas de notificación ni opera una cola/outbox financiera. En
esos casos el panel registra o visualiza el estado; la operación externa sigue
siendo responsabilidad del proveedor y del proceso de conciliación.
