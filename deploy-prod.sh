#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${script_dir}/.env.server"
with_nginx=false

usage() {
  printf 'Uso: %s [--env-file RUTA] [--with-nginx]\n' "${0##*/}"
}

while (($#)); do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --env-file\n' >&2; exit 2; }
      if [[ "$2" = /* ]]; then
        env_file="$2"
      else
        env_file="${script_dir}/$2"
      fi
      shift 2
      ;;
    --with-nginx)
      with_nginx=true
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

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

env_value() {
  local variable_name="$1"
  awk -v key="${variable_name}" '
    $0 ~ "^[[:space:]]*" key "=" {
      sub("^[[:space:]]*" key "=", "")
      sub("\\r$", "")
      if (($0 ~ /^\".*\"$/) || ($0 ~ /^\047.*\047$/)) {
        print substr($0, 2, length($0) - 2)
      } else {
        print
      }
      exit
    }
  ' "${env_file}"
}

require_value() {
  local variable_name="$1"
  [[ -n "$(env_value "${variable_name}")" ]] || fail "${variable_name} es obligatorio en ${env_file}"
}

require_secret() {
  local variable_name="$1"
  local variable_value
  variable_value="$(env_value "${variable_name}")"
  [[ ${#variable_value} -ge 32 ]] || fail "${variable_name} debe tener al menos 32 caracteres"
}

resolve_secret_path() {
  local container_path="$1"
  local certs_directory="$2"
  [[ "${container_path}" == /run/secrets/efi/* ]] || fail "Los certificados EFI deben montarse bajo /run/secrets/efi"
  [[ "${container_path}" != *'..'* ]] || fail "La ruta del certificado EFI no puede contener .."
  printf '%s/%s\n' "${certs_directory%/}" "${container_path#/run/secrets/efi/}"
}

[[ -f "${env_file}" ]] || fail "No existe ${env_file}; ejecute ./setup-env.sh y complételo"
command -v docker >/dev/null 2>&1 || fail 'Docker no está instalado'
docker compose version >/dev/null 2>&1 || fail 'Se requiere Docker Compose v2'

for variable_name in \
  MONGO_ROOT_USERNAME MONGO_ROOT_PASSWORD MONGO_APP_USERNAME MONGO_APP_PASSWORD \
  MONGO_DATABASE MONGO_REPLICA_SET MONGO_REPLICA_KEY MONGODB_URI \
  CORS_ORIGINS SMTP_HOST SMTP_PORT PAYMENTS_PROVIDER \
  EFI_PIX_CLIENT_ID EFI_PIX_CLIENT_SECRET EFI_PIX_KEY EFI_CERTS_DIR; do
  require_value "${variable_name}"
done

for secret_name in \
  MONGO_ROOT_PASSWORD MONGO_APP_PASSWORD MONGO_REPLICA_KEY \
  JWT_SECRET EMAIL_CODE_SECRET CHECKOUT_ACCESS_SECRET_KEY \
  PAYMENTS_ADMIN_API_KEY PAYMENTS_PUBLIC_SECRET_KEY \
  REFERRAL_IP_HASH_SECRET; do
  require_secret "${secret_name}"
done

mongo_uri="$(env_value MONGODB_URI)"
[[ "${mongo_uri}" == mongodb://* || "${mongo_uri}" == mongodb+srv://* ]] || fail 'MONGODB_URI no es una URI MongoDB'
if [[ "${mongo_uri}" != mongodb+srv://* && "${mongo_uri}" != *'replicaSet='* ]]; then
  fail 'MONGODB_URI debe incluir replicaSet'
fi

cors_origins="$(env_value CORS_ORIGINS)"
[[ "${cors_origins}" != *'*'* ]] || fail 'CORS_ORIGINS no puede usar comodines'
[[ "${cors_origins}" != *'.invalid'* ]] || fail 'Reemplace el dominio de ejemplo en CORS_ORIGINS'

smtp_user="$(env_value SMTP_USER)"
smtp_pass="$(env_value SMTP_PASS)"
smtp_from="$(env_value SMTP_FROM)"
[[ -n "${smtp_from}" || -n "${smtp_user}" ]] || fail 'Configure SMTP_FROM o SMTP_USER'
[[ -n "${smtp_user}" && -n "${smtp_pass}" ]] || [[ -z "${smtp_user}" && -z "${smtp_pass}" ]] || fail 'SMTP_USER y SMTP_PASS deben configurarse juntos'

[[ "$(env_value PAYMENTS_PROVIDER)" == efi ]] || fail 'Producción requiere PAYMENTS_PROVIDER=efi'
[[ "$(env_value PAYMENTS_ALLOW_MOCK)" != true ]] || fail 'PAYMENTS_ALLOW_MOCK no puede estar activo en producción'

webhook_hmac="$(env_value EFI_WEBHOOK_HMAC)"
webhook_mtls="$(env_value EFI_WEBHOOK_REQUIRE_MTLS)"
if [[ "${webhook_mtls}" != true && ${#webhook_hmac} -lt 24 ]]; then
  fail 'Configure EFI_WEBHOOK_HMAC (mínimo 24 caracteres) o habilite mTLS'
fi

certs_dir="$(env_value EFI_CERTS_DIR)"
if [[ "${certs_dir}" != /* ]]; then
  certs_dir="${script_dir}/${certs_dir#./}"
fi

p12_path="$(env_value EFI_PIX_CERTIFICATE_PATH)"
cert_path="$(env_value EFI_PIX_CERT_PATH)"
key_path="$(env_value EFI_PIX_KEY_PATH)"
if [[ -n "${p12_path}" ]]; then
  host_p12="$(resolve_secret_path "${p12_path}" "${certs_dir}")"
  [[ -f "${host_p12}" ]] || fail "No se encontró el certificado EFI configurado en ${host_p12}"
elif [[ -n "${cert_path}" && -n "${key_path}" ]]; then
  host_cert="$(resolve_secret_path "${cert_path}" "${certs_dir}")"
  host_key="$(resolve_secret_path "${key_path}" "${certs_dir}")"
  [[ -f "${host_cert}" ]] || fail "No se encontró ${host_cert}"
  [[ -f "${host_key}" ]] || fail "No se encontró ${host_key}"
else
  fail 'Configure EFI_PIX_CERTIFICATE_PATH o EFI_PIX_CERT_PATH + EFI_PIX_KEY_PATH'
fi

cd -- "${script_dir}"
compose=(docker compose --env-file "${env_file}" -f docker-compose.prod.yml)
if [[ "${with_nginx}" == true ]]; then
  compose+=(--profile proxy)
fi

printf '%s\n' 'Validando la configuración de producción...'
"${compose[@]}" config --quiet

printf '%s\n' 'Actualizando imágenes base y construyendo la API...'
"${compose[@]}" pull mongodb mongo-keyfile-init mongo-init-replica efi-cert-init
"${compose[@]}" build --pull api-sorteos

printf '%s\n' 'Aplicando el despliegue sin eliminar volúmenes ni detener previamente el servicio...'
"${compose[@]}" up -d --build --remove-orphans --wait --wait-timeout 240

"${compose[@]}" ps
api_port="$(env_value API_PORT)"
api_port="${api_port:-8017}"
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${api_port}/api/v1/health" >/dev/null \
  || fail 'La API no respondió correctamente después del despliegue'

printf 'Despliegue saludable en http://127.0.0.1:%s/api/v1\n' "${api_port}"
