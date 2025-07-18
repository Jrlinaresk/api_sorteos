#!/bin/bash

# Script para desarrollo
echo "🚀 Iniciando servicios de desarrollo..."

# Detener contenedores existentes
echo "⏹️  Deteniendo contenedores existentes..."
docker-compose down

# Construir e iniciar servicios
echo "🏗️  Construyendo e iniciando servicios..."
docker-compose up -d --build

# Mostrar estado
echo "📊 Estado de los servicios:"
docker-compose ps

# Mostrar logs
echo "📝 Logs en tiempo real (Ctrl+C para salir):"
docker-compose logs -f
