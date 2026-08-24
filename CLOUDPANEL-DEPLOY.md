# CloudPanel como proxy TLS

Esta es una variante concreta de [DEPLOYMENT.md](./DEPLOYMENT.md). CloudPanel
termina HTTPS y la API permanece accesible solo desde el propio servidor.

## Sitio

1. Cree un sitio de tipo reverse proxy para el dominio de la API.
2. Configure como upstream `http://127.0.0.1:8017`.
3. Emita y active el certificado Let's Encrypt.
4. Redirija HTTP a HTTPS y active HSTS desde CloudPanel, no desde el Nginx HTTP
   interno.

La configuración equivalente debe conservar estas cabeceras:

```nginx
proxy_pass http://127.0.0.1:8017;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 120s;
proxy_send_timeout 120s;
client_max_body_size 260m;
```

Estas cabeceras se sobrescriben deliberadamente. No use
`$proxy_add_x_forwarded_for` ni conserve `X-Real-IP` recibido del navegador:
la API usa esa IP para límites de solicitudes y auditoría. Los puertos `8017`
y `8081` deben continuar ligados exclusivamente a `127.0.0.1`.

El webhook de Efí **requiere mTLS en producción**. Instale en CloudPanel/Nginx la
cadena CA oficial publicada por Efí (es distinta del certificado cliente usado
por la API para llamar a Pix) y verifique el certificado solo en la ruta del
webhook. Una configuración equivalente es:

```nginx
# En el bloque server HTTPS:
ssl_client_certificate /ruta/privada/efi-webhook-ca.pem;
ssl_verify_client optional;

location ~ ^/api/v1/payments/webhooks/efi(?:/pix)?$ {
    if ($ssl_client_verify != SUCCESS) { return 403; }

    proxy_pass http://127.0.0.1:8017;
    proxy_set_header x-ssl-client-verify $ssl_client_verify;
    proxy_set_header x-efi-webhook-token "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

En las demás ubicaciones elimine cualquier valor recibido del navegador con
`proxy_set_header x-ssl-client-verify "";`. Nunca reenvíe esa cabecera sin
sobrescribirla. `x-efi-webhook-token` es una defensa adicional opcional y solo
debe configurarse si un gateway confiable la inyecta; no reemplaza mTLS.

Si despliega con `./deploy-prod.sh --with-nginx`, use en cambio
`http://127.0.0.1:8081` como upstream.

El primer despliegue con `--with-nginx` deja ese perfil persistente. Las
actualizaciones posteriores lo detectan y conservan aunque se omita la opción,
y validan el health atravesando `HTTP_PORT` (8081 por defecto).

## Backend

```bash
./setup-env.sh
# editar .env.server sin imprimirlo en logs ni tickets
# copiar las credenciales/certificado Pix en runtime/efi y la CA de webhook al proxy
./deploy-prod.sh
./diagnose.sh
```

En `.env.server`, `CORS_ORIGINS` debe contener los orígenes reales del frontend,
no necesariamente el dominio de la API. `TRUST_PROXY=true` permite que Nest use
correctamente la IP/protocolo remitidos por CloudPanel.

URLs de comprobación:

- `https://DOMINIO/api/v1/health`
- `https://DOMINIO/api/v1/...`
- `https://DOMINIO/api/docs` solo si `SWAGGER_ENABLED=true`

MongoDB no publica el puerto 27017 en producción; no añada una regla de firewall
ni un port mapping para él.

## Diagnóstico de un 502

```bash
curl --fail http://127.0.0.1:8017/api/v1/health
docker compose --env-file .env.server -f docker-compose.prod.yml ps
docker compose --env-file .env.server -f docker-compose.prod.yml logs --tail=100 api-sorteos
```

Si el primer comando falla, el problema está en el stack. Si responde y el
dominio devuelve 502, revise el upstream del sitio, TLS y el firewall local. No
publique `.env.server` para diagnosticar: `./diagnose.sh` realiza las comprobaciones
sin mostrar secretos.
