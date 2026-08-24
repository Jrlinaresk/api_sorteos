#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
template_path="${script_dir}/.env.example"
output_path="${script_dir}/.env.server"
force_write=false
development_mode=false

usage() {
  printf 'Uso: %s [--output RUTA] [--development] [--force]\n' "${0##*/}"
}

while (($#)); do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --output\n' >&2; exit 2; }
      output_path="$2"
      shift 2
      ;;
    --force)
      force_write=true
      shift
      ;;
    --development)
      development_mode=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Opción desconocida: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v openssl >/dev/null 2>&1 || {
  printf 'openssl es obligatorio para generar secretos seguros.\n' >&2
  exit 1
}

[[ -f "${template_path}" ]] || {
  printf 'No se encontró la plantilla %s\n' "${template_path}" >&2
  exit 1
}

if [[ -L "${output_path}" ]]; then
  printf '%s es un enlace simbólico; se rechaza por seguridad.\n' "${output_path}" >&2
  exit 1
fi

if [[ -e "${output_path}" && "${force_write}" != true ]]; then
  printf '%s ya existe; use --force solo si desea reemplazarlo.\n' "${output_path}" >&2
  exit 1
fi

mkdir -p -- "$(dirname -- "${output_path}")"
cp -- "${template_path}" "${output_path}"

set_value() {
  local variable_name="$1"
  local variable_value="$2"
  local replacement_path
  replacement_path="$(mktemp "${output_path}.tmp.XXXXXX")"
  awk -v key="${variable_name}" -v value="${variable_value}" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print key "=" value
    }
  ' "${output_path}" > "${replacement_path}"
  mv -- "${replacement_path}" "${output_path}"
}

random_secret() {
  openssl rand -hex 32
}

mongo_root_password="$(random_secret)"
mongo_app_password="$(random_secret)"
mongo_replica_key="$(random_secret)"

set_value MONGO_ROOT_PASSWORD "${mongo_root_password}"
set_value MONGO_APP_PASSWORD "${mongo_app_password}"
set_value MONGO_REPLICA_KEY "${mongo_replica_key}"
set_value MONGODB_URI "mongodb://sorteos_app:${mongo_app_password}@mongodb:27017/api_sorteos?authSource=api_sorteos&replicaSet=rs0&retryWrites=true&w=majority"
set_value JWT_SECRET "$(random_secret)"
set_value EMAIL_CODE_SECRET "$(random_secret)"
set_value CHECKOUT_ACCESS_SECRET_KEY "$(random_secret)"
set_value ORDER_ACCESS_CODE_SECRET "$(random_secret)"
set_value PAYMENTS_PUBLIC_SECRET_KEY "$(random_secret)"
set_value REFERRAL_IP_HASH_SECRET "$(random_secret)"

if [[ "${development_mode}" == true ]]; then
  set_value NODE_ENV development
  set_value API_PORT 8080
  set_value TRUST_PROXY false
  set_value CORS_ORIGINS http://localhost:3000
  set_value SWAGGER_ENABLED true
  set_value PAYMENTS_PROVIDER mock
  set_value PAYMENTS_ALLOW_MOCK true
  set_value EFI_PIX_ENV sandbox
  set_value EFI_PIX_CERTIFICATE_PATH ''
  set_value EFI_WEBHOOK_HMAC ''
  set_value EFI_WEBHOOK_REQUIRE_MTLS false
else
  # Efí autentica su webhook nativo mediante certificado cliente. Un token en
  # cabecera solo es válido como defensa adicional cuando un gateway confiable
  # lo inyecta; no puede sustituir mTLS en producción.
  set_value EFI_WEBHOOK_HMAC ''
  set_value EFI_WEBHOOK_REQUIRE_MTLS true
fi

chmod 600 "${output_path}"
install -d -m 700 "${script_dir}/runtime/efi"

printf 'Entorno creado en %s con permisos 0600.\n' "${output_path}"
if [[ "${development_mode}" == true ]]; then
  printf '%s\n' 'Entorno de desarrollo listo para Docker Compose; los pagos usan el proveedor mock.'
else
  printf '%s\n' 'Complete CORS_ORIGINS, SMTP_*, EFI_PIX_*, configure mTLS de Efí en el proxy TLS y copie el certificado en runtime/efi antes de desplegar.'
fi
