# AuditModule

Registro append-only para acciones administrativas, accesos sensibles y eventos
de seguridad.

## Integración

Importar `AuditModule` en el módulo raíz. Los endpoints incluidos son:

- `GET /admin/audit-logs`
- `GET /admin/audit-logs/:id`
- `GET /admin/audit-logs/export.csv`

Todos requieren JWT y rol `admin` u `operator`.

Otros servicios pueden inyectar `AuditService` y usar `record()` con `before` y
`after`. Los controladores pueden usar `@AuditAction(...)` junto con
`AuditInterceptor`.

La aplicación rechaza updates y deletes sobre la colección. Para garantías
contra administradores de base de datos se recomienda además usar un usuario de
MongoDB sin permisos `update`/`delete` sobre `audit_logs` y enviar una copia a
almacenamiento WORM o a un colector externo.

La exportación CSV está limitada a 50.000 filas y neutraliza fórmulas de hojas
de cálculo.
