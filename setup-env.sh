#!/bin/bash

# Script para configurar rápidamente las variables de entorno
echo "⚙️  Configurando variables de entorno para producción..."

# Verificar si ya existe el archivo
if [ -f .env.server ]; then
    echo "📝 El archivo .env.server ya existe."
    read -p "¿Deseas sobrescribirlo? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Configuración cancelada."
        exit 1
    fi
fi

# Crear archivo de variables de entorno
cat > .env.server << 'EOF'
# Variables de entorno para producción
NODE_ENV=production
PORT=8080

# Base de datos
DB_HOST=mongodb
DB_PORT=27017
DB_USER=develop
DB_PASSWORD=Dbabnsmdb2024
DB_NAME=api_rest_sorteos_nestjs_mongodb
MONGODB_URI=mongodb://develop:Dbabnsmdb2024@mongodb:27017/api_rest_sorteos_nestjs_mongodb?authSource=admin

# JWT - CAMBIAR EN PRODUCCIÓN
JWT_SECRET=sorteos-cuba-jwt-secret-key-production-2025-change-me

# Email - CONFIGURAR CON VALORES REALES
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@sorteoscuba.everom.net
SMTP_PASS=temporal-password-change-me

# Configuraciones adicionales
API_VERSION=v1
CORS_ORIGINS=https://sorteoscuba.everom.net
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100
LOG_LEVEL=info
LOG_FILE=./logs/app.log
EOF

echo "✅ Archivo .env.server creado exitosamente"
echo ""
echo "🔐 IMPORTANTE: Configurar las siguientes variables antes de desplegar:"
echo "   - JWT_SECRET: Cambia por una clave segura"
echo "   - SMTP_USER: Email real para envío de correos"
echo "   - SMTP_PASS: Contraseña de aplicación del email"
echo ""
echo "💡 Edita el archivo con: nano .env.server"
echo "🚀 Después ejecuta: ./deploy-prod.sh"
