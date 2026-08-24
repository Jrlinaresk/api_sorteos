lo que nos falta para ser pro

Tu backend **no tiene una limitación importante para operar una web de sorteos brasileña propia, con una sola marca y pagos Pix**, como la referencia. Las limitaciones aparecen cuando quieres convertirlo en una plataforma más universal o SaaS.

| Actualmente no permite                    | Consecuencia práctica                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiempresa/multi-tenant                 | No puedes permitir que muchos organizadores creen sus propias cuentas, marcas, dominios y credenciales Pix dentro de la misma instalación.    |
| Otros pagos                               | Solo admite Pix/Efí y BRL. No hay tarjeta, boleto, cuotas, PayPal, Stripe, Mercado Pago, wallets ni suscripciones.                            |
| Operación internacional                   | Checkout brasileño con CPF, Pix y BRL. No hay monedas, idiomas, impuestos ni reglas por país.                                                 |
| KYC e identidad real                      | Valida matemáticamente el CPF y confirma el correo, pero no comprueba titularidad del CPF, teléfono, edad 18+, documento, selfie o biometría. |
| Tiempo real nativo                        | No hay WebSocket/SSE. Pagos, progreso y resultados deben actualizarse mediante polling.                                                       |
| SMS o WhatsApp automático                 | Puede mostrar enlaces de WhatsApp, pero no enviar OTP, campañas, conversaciones o avisos mediante WhatsApp/SMS.                               |
| Logística automática                      | Permite registrar manualmente que un premio fue entregado, pero no gestiona dirección, transportista, tracking, comprobantes o firma.         |
| Pagos automáticos a ganadores y afiliados | Registra premios y comisiones, pero no ejecuta transferencias Pix, split, retiros ni conciliación de esos desembolsos.                        |
| Facturación y contabilidad                | No genera NF-e/NFS-e, libros contables, cierre de caja, tasas del PSP, importación de extractos ni conciliación bancaria masiva.              |
| Infraestructura multimedia distribuida    | Los archivos se guardan en volumen local; no hay adaptador activo para S3, R2, GCS o CDN.                                                     |
| BI avanzado                               | No hay dashboard financiero completo, funnels, ventas netas, reportes programados, XLSX o integración con un data warehouse.                  |
| Atención al cliente                       | No existe sistema de tickets, chat, conversaciones, SLA o integración con un helpdesk.                                                        |

También hay algunas limitaciones específicas del producto:

- Los números se asignan automáticamente; el comprador no puede escogerlos.
- El flujo final gestiona actualmente un premio principal por campaña. Para varios premios principales independientes habría que ampliarlo.
- No existen campañas gratuitas, subastas, membresías, sorteos recurrentes o torneos.
- No hay carrito que combine varias campañas en una compra.
- No hay pausa, clonación, plantillas de campañas ni reembolso masivo por campaña.
- Los usuarios no tienen todavía autoservicio completo LGPD para exportar, anonimizar o borrar sus propios datos.
- El backend no legaliza la operación ni obtiene autorizaciones regulatorias.

Hay que distinguir esto de funciones que sí existen pero necesitan configuración:

- Pix real: instalar credenciales y certificado de Efí.
- Correos: configurar SMTP.
- Push: configurar VAPID y el frontend PWA.
- Producción: MongoDB replica set, HTTPS, backups y monitorización.
- Apariencia: desarrollar frontend y panel administrativo.

En resumen:

- **Una web brasileña propia tipo Uerick07:** sí.
- **Varias webs separadas instalando una instancia por marca:** sí.
- **Marketplace SaaS para muchos organizadores:** todavía no.
- **Plataforma internacional o financiera avanzada:** todavía no.
- **Operación totalmente automatizada, desde KYC hasta entrega y contabilidad:** todavía no.

Las limitaciones actuales también están reflejadas en [BACKEND-WEB-CAPABILITIES.md](</Users/kronox5/development/proyects/GitHub/00 - Produccion/Sorteos propios/bakend/api_sorteos/BACKEND-WEB-CAPABILITIES.md:338>).
