# Imagen base con Node.js 18
FROM node:18-alpine AS base

# Establecer directorio de trabajo
WORKDIR /app

# Instalar dependencias necesarias para compilación y healthcheck
RUN apk add --no-cache libc6-compat wget

# Copiar archivos de configuración de dependencias
COPY package*.json ./
COPY .npmrc ./

# Limpiar cache de npm y generar package-lock fresh
RUN npm cache clean --force

# Instalar dependencias con npm install (no ci para evitar conflictos)
RUN npm install --omit=dev --verbose && npm cache clean --force

# Etapa de desarrollo/construcción
FROM node:18-alpine AS builder

WORKDIR /app

# Copiar archivos de configuración
COPY package*.json ./
COPY .npmrc ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Instalar todas las dependencias (incluyendo dev)
RUN npm install --verbose

# Copiar código fuente
COPY src ./src

# Construir la aplicación
RUN npm run build

# Etapa de producción
FROM node:18-alpine AS production

# Crear usuario no root para seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Instalar wget para healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copiar dependencias de producción
COPY --from=base --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=base --chown=nestjs:nodejs /app/package.json ./package.json

# Copiar aplicación construida
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Copiar archivos estáticos si existen
COPY --from=builder --chown=nestjs:nodejs /app/src/assets ./src/assets
COPY --from=builder --chown=nestjs:nodejs /app/src/templates ./src/templates

# Cambiar a usuario no root
USER nestjs

# Exponer puerto
EXPOSE 8080

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=8080

# Comando de inicio
CMD ["node", "dist/main"]
