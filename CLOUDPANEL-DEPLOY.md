# 🚀 Despliegue en CloudPanel - API Sorteos

## Pasos para desplegar en CloudPanel

### 1. Configurar el sitio en CloudPanel

1. **Crear sitio de tipo "Proxy Reverso"**
   - Dominio: `sorteoscuba.everom.net`
   - Proxy URL: `http://localhost:8017`
   - SSL: Activar Let's Encrypt

### 2. Configurar variables de entorno

```bash
# En el servidor, dentro del directorio del proyecto
./setup-env.sh

# Editar las variables importantes
nano .env.server
```

**Variables críticas a configurar:**
- `JWT_SECRET`: Clave segura para JWT
- `SMTP_USER`: Email real (ej: `noreply@sorteoscuba.everom.net`)
- `SMTP_PASS`: Contraseña de aplicación del email

### 3. Desplegar la aplicación

```bash
# Ejecutar despliegue
./deploy-prod.sh
```

### 4. Verificar el estado

```bash
# Diagnóstico completo
./diagnose.sh

# Ver logs en tiempo real
docker compose -f docker-compose.prod.yml logs -f api-sorteos
```

## 🌐 URLs disponibles

- **API**: `https://sorteoscuba.everom.net/api/v1`
- **Swagger**: `https://sorteoscuba.everom.net/api`
- **Health Check**: `https://sorteoscuba.everom.net/api/v1/health`

## 🔧 Configuración CloudPanel

### Configuración del Proxy Reverso

```nginx
# CloudPanel genera automáticamente esta configuración
proxy_pass http://localhost:8017;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

### Puertos utilizados

- **8017**: Puerto externo de la aplicación (al que se conecta CloudPanel)
- **8080**: Puerto interno de la aplicación (dentro del contenedor)
- **27017**: Puerto de MongoDB

## 🔍 Solución de problemas

### Error 502 - Bad Gateway

1. **Verificar que los contenedores estén corriendo:**
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```

2. **Verificar logs de la aplicación:**
   ```bash
   docker compose -f docker-compose.prod.yml logs api-sorteos
   ```

3. **Verificar conectividad interna:**
   ```bash
   curl http://localhost:8017/api/v1/health
   ```

### Error de variables de entorno

1. **Verificar archivo .env.server:**
   ```bash
   cat .env.server
   ```

2. **Reconfigurar variables:**
   ```bash
   ./setup-env.sh
   ```

3. **Redesplegar:**
   ```bash
   ./deploy-prod.sh
   ```

### Error de base de datos

1. **Verificar MongoDB:**
   ```bash
   docker compose -f docker-compose.prod.yml exec mongodb mongosh
   ```

2. **Revisar logs de MongoDB:**
   ```bash
   docker compose -f docker-compose.prod.yml logs mongodb
   ```

## 📊 Monitoreo

### Ver estado de recursos

```bash
# Uso de CPU y memoria
docker stats

# Espacio en disco
df -h

# Logs del sistema
journalctl -u docker.service -f
```

### Comandos útiles

```bash
# Reiniciar solo la aplicación
docker compose -f docker-compose.prod.yml restart api-sorteos

# Actualizar sin downtime
docker compose -f docker-compose.prod.yml up -d --force-recreate api-sorteos

# Backup de la base de datos
docker compose -f docker-compose.prod.yml exec mongodb mongodump --out /tmp/backup

# Limpiar logs
docker compose -f docker-compose.prod.yml logs api-sorteos --tail=0 -f
```

## 🔐 Seguridad

### Configuraciones recomendadas

1. **Cambiar credenciales por defecto:**
   - JWT_SECRET
   - DB_PASSWORD
   - SMTP_PASS

2. **Configurar firewall:**
   ```bash
   # Permitir solo puertos necesarios
   ufw allow 22    # SSH
   ufw allow 80    # HTTP
   ufw allow 443   # HTTPS
   ```

3. **Configurar SSL:**
   - CloudPanel maneja automáticamente Let's Encrypt
   - Verificar renovación automática

### Backup automático

```bash
# Crear script de backup
cat > /etc/cron.daily/api-sorteos-backup << 'EOF'
#!/bin/bash
cd /path/to/api_sorteos
docker compose -f docker-compose.prod.yml exec mongodb mongodump --out /tmp/backup-$(date +%Y%m%d)
EOF

chmod +x /etc/cron.daily/api-sorteos-backup
```

## 📞 Soporte

Para problemas específicos:

1. **Revisar logs:** `./diagnose.sh`
2. **Verificar configuración:** `cat .env.server`
3. **Reiniciar servicios:** `./deploy-prod.sh`

### Contacto

- **Repositorio:** `https://github.com/Jrlinaresk/api_sorteos`
- **Branch:** `deploy`
