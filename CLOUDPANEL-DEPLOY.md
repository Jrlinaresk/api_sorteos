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

Si se habilita mTLS para el webhook EFI, CloudPanel debe validar el certificado
cliente y sobrescribir la cabecera confiable con el resultado de Nginx (por
ejemplo, `proxy_set_header x-ssl-client-verify $ssl_client_verify;`). Nunca se
debe reenviar una cabecera de verificación enviada por el cliente.

Si despliega con `./deploy-prod.sh --with-nginx`, use en cambio
`http://127.0.0.1:8081` como upstream.

## Backend

```bash
./setup-env.sh
# editar .env.server sin imprimirlo en logs ni tickets
# copiar las credenciales/certificado EFI en runtime/efi
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
