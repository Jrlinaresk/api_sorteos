#!/bin/bash

# Script de diagnóstico para verificar el estado de la aplicación
echo "🔍 Diagnóstico de la aplicación API Sorteos"
echo "=========================================="

# Verificar si Docker está corriendo
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker no está corriendo"
    exit 1
fi
echo "✅ Docker está corriendo"

# Verificar archivo de variables de entorno
if [ ! -f .env.server ]; then
    echo "❌ Archivo .env.server no encontrado"
    echo "💡 Ejecuta: ./setup-env.sh"
    exit 1
fi
echo "✅ Archivo .env.server encontrado"

# Verificar contenedores
echo ""
echo "📊 Estado de los contenedores:"
docker compose -f docker-compose.prod.yml ps

# Verificar logs de la aplicación
echo ""
echo "📝 Últimos logs de la aplicación:"
docker compose -f docker-compose.prod.yml logs --tail=20 api-sorteos

# Verificar conectividad
echo ""
echo "🌐 Probando conectividad:"

# Verificar puerto interno
if docker compose -f docker-compose.prod.yml exec api-sorteos wget -q --spider http://localhost:8080/api/v1/health 2>/dev/null; then
    echo "✅ Aplicación responde internamente en puerto 8080"
else
    echo "❌ Aplicación no responde internamente"
fi

# Verificar puerto externo
if curl -s http://localhost:8017/api/v1/health > /dev/null 2>&1; then
    echo "✅ Aplicación responde externamente en puerto 8017"
else
    echo "❌ Aplicación no responde externamente en puerto 8017"
fi

# Verificar base de datos
echo ""
echo "🗄️  Verificando base de datos:"
if docker compose -f docker-compose.prod.yml exec mongodb mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo "✅ MongoDB está funcionando"
else
    echo "❌ MongoDB no responde"
fi

# Mostrar información del sistema
echo ""
echo "💻 Información del sistema:"
echo "Uso de memoria:"
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" $(docker compose -f docker-compose.prod.yml ps -q) 2>/dev/null || echo "No hay contenedores corriendo"

echo ""
echo "📋 Resumen de puertos:"
echo "- Puerto interno aplicación: 8080"
echo "- Puerto externo aplicación: 8017"
echo "- Puerto MongoDB: 27017"
echo "- URL de la API: http://localhost:8017/api/v1"
echo "- URL de Swagger: http://localhost:8017/api"
echo "- Health Check: http://localhost:8017/api/v1/health"
