# 🚀 Guía de Despliegue - API Sorteos

## 📋 Requisitos previos

- Docker >= 20.10
- Docker Compose >= 2.0
- Node.js >= 18 (para desarrollo local)

## 🏗️ Estructura del proyecto

```
api_sorteos/
├── Dockerfile                    # Imagen de producción optimizada
├── docker-compose.yml           # Configuración para desarrollo
├── docker-compose.prod.yml      # Configuración para producción
├── .dockerignore               # Archivos excluidos del build
├── deploy-prod.sh              # Script de despliegue producción
├── deploy-dev.sh               # Script de despliegue desarrollo
├── .env.production             # Variables de producción
├── .env.development            # Variables de desarrollo
└── nginx/
    └── nginx.conf              # Configuración del proxy reverso
```

## 🚀 Despliegue en Producción

### Opción 1: Script automático (Recomendado)

```bash
# Ejecutar script de despliegue
./deploy-prod.sh
```

### Opción 2: Manual

```bash
# 1. Detener servicios existentes
docker-compose -f docker-compose.prod.yml down

# 2. Construir imagen
docker-compose -f docker-compose.prod.yml build --no-cache

# 3. Iniciar servicios
docker-compose -f docker-compose.prod.yml up -d

# 4. Verificar estado
docker-compose -f docker-compose.prod.yml ps
```

## 🔧 Desarrollo

### Opción 1: Script automático

```bash
# Ejecutar script de desarrollo
./deploy-dev.sh
```

### Opción 2: Manual

```bash
# 1. Iniciar servicios
docker-compose up -d --build

# 2. Ver logs
docker-compose logs -f
```

## 🌐 Endpoints disponibles

| Endpoint | Descripción |
|----------|-------------|
| `http://localhost:8080/api/v1` | API principal |
| `http://localhost:8080/api` | Documentación Swagger |
| `http://localhost:8080/api/v1/health` | Health check |

## 📊 Servicios incluidos

### 🔹 API NestJS
- **Puerto**: 8080
- **Contenedor**: `api-sorteos-app`
- **Health check**: Disponible en `/api/v1/health`
- **Recursos**: 512MB RAM, 1 CPU

### 🔹 MongoDB
- **Puerto**: 27017
- **Contenedor**: `mongodb-api-rest-sorteos`
- **Base de datos**: `api_rest_sorteos_nestjs_mongodb`
- **Volumen persistente**: `mongo-data`

### 🔹 Nginx (Opcional)
- **Puerto**: 80/443
- **Contenedor**: `nginx-api-sorteos`
- **Función**: Proxy reverso y balanceador de carga
- **Configuración**: Rate limiting, compresión, SSL

## ⚙️ Configuración

### Variables de entorno

Edita `.env.production` para producción:

```env
NODE_ENV=production
PORT=8080
MONGODB_URI=mongodb://develop:Dbabnsmdb2024@mongodb:27017/api_rest_sorteos_nestjs_mongodb?authSource=admin
JWT_SECRET=your-super-secret-jwt-key-here
```

### Base de datos

La conexión a MongoDB se configura automáticamente:
- **Usuario**: `develop`
- **Contraseña**: `Dbabnsmdb2024`
- **Host**: `mongodb` (en contenedor)
- **Puerto**: `27017`

## 🔍 Monitoreo

### Health checks

```bash
# Verificar estado de la API
curl http://localhost:8080/api/v1/health

# Verificar logs
docker-compose logs -f api-sorteos
```

### Comandos útiles

```bash
# Ver estado de contenedores
docker-compose ps

# Reiniciar solo la API
docker-compose restart api-sorteos

# Limpiar volúmenes (¡CUIDADO! Elimina datos)
docker-compose down -v

# Acceder al contenedor
docker exec -it api-sorteos-app sh

# Ver logs en tiempo real
docker-compose logs -f
```

## 🔐 Seguridad

### Producción

- Cambiar las credenciales por defecto
- Configurar SSL en Nginx
- Configurar firewall
- Usar secrets de Docker para contraseñas

### Ejemplo de configuración SSL

```nginx
server {
    listen 443 ssl http2;
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    # ... resto de configuración
}
```

## 📈 Optimización

### Recursos

Los límites de recursos están configurados en `docker-compose.prod.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

### Escalado

```bash
# Escalar la API a 3 instancias
docker-compose -f docker-compose.prod.yml up -d --scale api-sorteos=3
```

## 🆘 Solución de problemas

### Problemas comunes

1. **Puerto ocupado**
   ```bash
   # Verificar qué usa el puerto
   lsof -i :8080
   # Cambiar puerto en docker-compose.yml
   ```

2. **Error de conexión MongoDB**
   ```bash
   # Verificar logs de MongoDB
   docker-compose logs mongodb
   # Verificar conectividad
   docker exec -it mongodb-api-rest-sorteos mongosh
   ```

3. **Problema de permisos**
   ```bash
   # Ejecutar como root
   sudo docker-compose up -d
   ```

## 📚 Documentación adicional

- [Documentación NestJS](https://docs.nestjs.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- [MongoDB Docker](https://hub.docker.com/_/mongo)

## 🤝 Contribución

Para contribuir al proyecto:

1. Fork el repositorio
2. Crear rama feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Crear Pull Request

---

**Nota**: Este proyecto está configurado para NestJS. Si encuentras algún problema, revisa los logs con `docker-compose logs -f` y verifica la configuración de las variables de entorno.
