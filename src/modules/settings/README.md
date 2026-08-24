# SettingsModule

Configuración versionada para el sitio web: marca, contactos, redes, tema,
documentos legales y feature flags.

## Integración

Importar `SettingsModule` en el módulo raíz. Este módulo importa `AuditModule`
para registrar cada creación, edición, publicación y archivo.

## Endpoints

- Público: `GET /settings/public`.
- Admin/operator: `GET /admin/settings` y `GET /admin/settings/:version`.
- Solo admin: `POST /admin/settings`, `PATCH /admin/settings/:version`,
  `POST /admin/settings/:version/publish` y `DELETE /admin/settings/:version`.

`DELETE` archiva en vez de borrar para conservar el historial. Una versión
publicada no vuelve a modificarse y la versión pública vigente no puede
archivarse hasta publicar otra.

El frontend debe consumir únicamente `/settings/public`. Si todavía no hay una
versión publicada, recibe valores predeterminados con `version: 0`.
