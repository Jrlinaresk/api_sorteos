#!/bin/bash

# Script para desplegar la aplicación en producción
echo "🚀 Iniciando despliegue de producción..."

# Detener contenedores existentes
echo "⏹️  Deteniendo contenedores existentes..."
docker-compose -f docker-compose.prod.yml down

# Limpiar imágenes no utilizadas
echo "🧹 Limpiando imágenes no utilizadas..."
docker image prune -f

# Construir nueva imagen
echo "🏗️  Construyendo nueva imagen..."
docker-compose -f docker-compose.prod.yml build --no-cache

# Iniciar servicios
echo "🚀 Iniciando servicios en producción..."
docker-compose -f docker-compose.prod.yml up -d

# Mostrar estado de los servicios
echo "📊 Estado de los servicios:"
docker-compose -f docker-compose.prod.yml ps

# Verificar health checks
echo "🔍 Verificando health checks..."
sleep 30
docker-compose -f docker-compose.prod.yml ps

echo "✅ Despliegue completado!"
echo "🌐 La aplicación está disponible en:"
echo "   - API: http://localhost:8080/api/v1"
echo "   - Swagger: http://localhost:8080/api"
echo "   - Health Check: http://localhost:8080/api/v1/health"
