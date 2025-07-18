#!/bin/bash

# Script para desplegar la aplicación en producción
echo "🚀 Iniciando despliegue de producción..."

# Verificar si existe el archivo de variables de entorno
if [ ! -f .env.server ]; then
    echo "📝 Creando archivo de variables de entorno..."
    cp .env.server .env.server
    echo "⚠️  IMPORTANTE: Edita el archivo .env.server con los valores reales antes de continuar"
    echo "⚠️  Especialmente las variables SMTP_* y JWT_SECRET"
    read -p "¿Deseas continuar con valores temporales? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Despliegue cancelado. Configura .env.server primero."
        exit 1
    fi
fi

# Limpiar package-lock.json para evitar conflictos
echo "🧹 Limpiando package-lock.json..."
rm -f package-lock.json

# Detener contenedores existentes
echo "⏹️  Deteniendo contenedores existentes..."
docker compose -f docker-compose.prod.yml down

# Limpiar imágenes no utilizadas
echo "🧹 Limpiando imágenes no utilizadas..."
docker image prune -f

# Construir nueva imagen
echo "🏗️  Construyendo nueva imagen..."
docker compose -f docker-compose.prod.yml build --no-cache

# Iniciar servicios
echo "🚀 Iniciando servicios en producción..."
docker compose -f docker-compose.prod.yml up -d

# Mostrar estado de los servicios
echo "📊 Estado de los servicios:"
docker compose -f docker-compose.prod.yml ps

# Verificar health checks
echo "🔍 Verificando health checks..."
sleep 30
docker compose -f docker-compose.prod.yml ps

echo "✅ Despliegue completado!"
echo "🌐 La aplicación está disponible en:"
echo "   - API: http://localhost:8080/api/v1"
echo "   - Swagger: http://localhost:8080/api"
echo "   - Health Check: http://localhost:8080/api/v1/health"
