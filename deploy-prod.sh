#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${script_dir}/.env.server"
with_nginx=false
check_only=false

usage() {
  printf 'Uso: %s [--env-file RUTA] [--with-nginx] [--check]\n' "${0##*/}"
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
    --check)
      check_only=true
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

file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

require_private_file() {
  local private_path="$1"
  local description="$2"
  local mode_value
  local mode_number
  [[ -f "${private_path}" && ! -L "${private_path}" ]] || fail "No se encontró ${description} o es un enlace simbólico"
  mode_value="$(file_mode "${private_path}")"
  mode_number=$((8#${mode_value}))
  (( (mode_number & 077) == 0 )) || fail "${description} no puede ser legible por grupo/otros (modo ${mode_value})"
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
require_private_file "${env_file}" "el archivo de entorno"
command -v docker >/dev/null 2>&1 || fail 'Docker no está instalado'
compose_version="$(docker compose version --short 2>/dev/null)" || fail 'Se requiere Docker Compose v2.20 o superior'
compose_version="${compose_version#v}"
compose_major="${compose_version%%.*}"
compose_remainder="${compose_version#*.}"
compose_minor="${compose_remainder%%.*}"
[[ "${compose_major}" =~ ^[0-9]+$ && "${compose_minor}" =~ ^[0-9]+$ ]] \
  || fail 'No se pudo determinar la versión de Docker Compose'
(( compose_major > 2 || (compose_major == 2 && compose_minor >= 20) )) \
  || fail 'Se requiere Docker Compose v2.20 o superior'

for port_name in API_PORT HTTP_PORT; do
  port_value="$(env_value "${port_name}")"
  if [[ -n "${port_value}" ]]; then
    if [[ ! "${port_value}" =~ ^[0-9]+$ ]] \
      || ((port_value < 1 || port_value > 65535)); then
      fail "${port_name} debe ser un puerto entre 1 y 65535"
    fi
  fi
done

docker_log_max_size="$(env_value DOCKER_LOG_MAX_SIZE)"
docker_log_max_size="${docker_log_max_size:-10m}"
[[ "${docker_log_max_size}" =~ ^[1-9][0-9]*[kKmMgG]$ ]] \
  || fail 'DOCKER_LOG_MAX_SIZE debe usar un tamaño como 10m o 1g'
docker_log_size_number="${docker_log_max_size%?}"
docker_log_size_unit="$(printf '%s' "${docker_log_max_size: -1}" | tr 'KMG' 'kmg')"
case "${docker_log_size_unit}" in
  k) ((docker_log_size_number >= 1024 && docker_log_size_number <= 1048576)) ;;
  m) ((docker_log_size_number >= 1 && docker_log_size_number <= 1024)) ;;
  g) ((docker_log_size_number == 1)) ;;
  *) false ;;
esac || fail 'DOCKER_LOG_MAX_SIZE debe estar entre 1m y 1g'
docker_log_max_files="$(env_value DOCKER_LOG_MAX_FILES)"
docker_log_max_files="${docker_log_max_files:-5}"
if [[ ! "${docker_log_max_files}" =~ ^[0-9]+$ ]] \
  || ((docker_log_max_files < 1 || docker_log_max_files > 20)); then
  fail 'DOCKER_LOG_MAX_FILES debe ser un entero entre 1 y 20'
fi

for variable_name in \
  MONGO_ROOT_USERNAME MONGO_ROOT_PASSWORD MONGO_APP_USERNAME MONGO_APP_PASSWORD \
  MONGO_DATABASE MONGO_REPLICA_SET MONGO_REPLICA_KEY MONGODB_URI \
  CORS_ORIGINS SMTP_HOST SMTP_PORT PAYMENTS_PROVIDER \
  EFI_PIX_CLIENT_ID EFI_PIX_CLIENT_SECRET EFI_PIX_KEY EFI_CERTS_DIR; do
  require_value "${variable_name}"
done

for secret_name in \
  MONGO_ROOT_PASSWORD MONGO_APP_PASSWORD MONGO_REPLICA_KEY \
  JWT_SECRET EMAIL_CODE_SECRET CHECKOUT_ACCESS_SECRET_KEY ORDER_ACCESS_CODE_SECRET \
  PAYMENTS_PUBLIC_SECRET_KEY \
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
[[ "${webhook_mtls}" == true ]] \
  || fail 'EFI_WEBHOOK_REQUIRE_MTLS=true es obligatorio con Efí en producción'
if [[ -n "${webhook_hmac}" && ${#webhook_hmac} -lt 24 ]]; then
  fail 'EFI_WEBHOOK_HMAC debe tener al menos 24 caracteres si se configura'
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
  require_private_file "${host_p12}" "el certificado EFI ${host_p12}"
elif [[ -n "${cert_path}" && -n "${key_path}" ]]; then
  host_cert="$(resolve_secret_path "${cert_path}" "${certs_dir}")"
  host_key="$(resolve_secret_path "${key_path}" "${certs_dir}")"
  require_private_file "${host_cert}" "el certificado EFI ${host_cert}"
  require_private_file "${host_key}" "la clave privada EFI ${host_key}"
else
  fail 'Configure EFI_PIX_CERTIFICATE_PATH o EFI_PIX_CERT_PATH + EFI_PIX_KEY_PATH'
fi

cd -- "${script_dir}"
compose_base=(docker compose --env-file "${env_file}" -f docker-compose.prod.yml)

# Si el proxy se activó en un despliegue anterior, conservarlo aunque el
# operador omita --with-nginx. Esto también hace que el health final compruebe
# la misma entrada por la que realmente llega el tráfico.
if [[ "${with_nginx}" != true ]] \
  && "${compose_base[@]}" ps --all --services 2>/dev/null | grep -Fxq nginx; then
  with_nginx=true
  printf '%s\n' 'Se detectó nginx existente; se conservará el perfil proxy.'
fi

compose=("${compose_base[@]}")
if [[ "${with_nginx}" == true ]]; then
  compose+=(--profile proxy)
fi

printf '%s\n' 'Validando la configuración de producción...'
"${compose[@]}" config --quiet

if [[ "${check_only}" == true ]]; then
  printf '%s\n' 'Preflight de producción correcto; no se modificó ningún servicio.'
  exit 0
fi

printf '%s\n' 'Actualizando imágenes base y construyendo la API...'
images=(mongodb mongo-keyfile-init mongo-init-replica efi-cert-init)
if [[ "${with_nginx}" == true ]]; then
  images+=(nginx)
fi
"${compose[@]}" pull "${images[@]}"
"${compose[@]}" build --pull api-sorteos

printf '%s\n' 'Aplicando el despliegue sin eliminar volúmenes ni detener previamente el servicio...'
# No se usa --remove-orphans: un perfil opcional ya desplegado nunca debe ser
# borrado por una ejecución posterior que no lo haya mencionado.
"${compose[@]}" up -d --wait --wait-timeout 360

"${compose[@]}" ps
if [[ "${with_nginx}" == true ]]; then
  health_port="$(env_value HTTP_PORT)"
  health_port="${health_port:-8081}"
  health_component='nginx'
else
  health_port="$(env_value API_PORT)"
  health_port="${health_port:-8017}"
  health_component='API'
fi
health_url="http://127.0.0.1:${health_port}/api/v1/health"
curl --fail --silent --show-error --max-time 10 "${health_url}" >/dev/null \
  || fail "${health_component} no respondió correctamente después del despliegue en ${health_url}"

printf 'Despliegue saludable a través de %s en http://127.0.0.1:%s/api/v1\n' \
  "${health_component}" "${health_port}"
