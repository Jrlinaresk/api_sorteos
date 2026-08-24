#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${script_dir}/.env.server"
compose_file="docker-compose.prod.yml"
diagnostic_failed=false

while (($#)); do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --env-file\n' >&2; exit 2; }
      if [[ "$2" = /* ]]; then env_file="$2"; else env_file="${script_dir}/$2"; fi
      shift 2
      ;;
    --development)
      compose_file="docker-compose.yml"
      env_file="${script_dir}/.env.docker.local"
      shift
      ;;
    -h|--help)
      printf 'Uso: %s [--env-file RUTA] [--development]\n' "${0##*/}"
      exit 0
      ;;
    *)
      printf 'Opción desconocida: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

check() {
  local description="$1"
  shift
  if "$@"; then
    printf 'OK  %s\n' "${description}"
  else
    printf 'FALLO  %s\n' "${description}" >&2
    diagnostic_failed=true
  fi
}

env_value() {
  local variable_name="$1"
  awk -v key="${variable_name}" '
    $0 ~ "^[[:space:]]*" key "=" {
      sub("^[[:space:]]*" key "=", "")
      sub("\\r$", "")
      gsub(/^\"|\"$/, "")
      print
      exit
    }
  ' "${env_file}"
}

printf '%s\n' 'Diagnóstico de API Sorteos'
check 'Docker responde' docker info
[[ -f "${env_file}" ]] || { printf 'FALLO  No existe %s\n' "${env_file}" >&2; exit 1; }

cd -- "${script_dir}"
compose=(docker compose --env-file "${env_file}" -f "${compose_file}")
check 'Compose es válido' "${compose[@]}" config --quiet

printf '\nEstado de servicios:\n'
"${compose[@]}" ps

printf '\nÚltimos logs de la API:\n'
"${compose[@]}" logs --tail=30 api-sorteos

api_port="$(env_value API_PORT)"
if [[ -z "${api_port}" ]]; then
  if [[ "${compose_file}" == docker-compose.prod.yml ]]; then api_port=8017; else api_port=8080; fi
fi
check 'Health HTTP en loopback' curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${api_port}/api/v1/health"

check 'MongoDB autenticado y primario' \
  "${compose[@]}" exec -T mongodb /bin/bash -ec \
  'mongosh --quiet --host 127.0.0.1 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "quit(db.hello().isWritablePrimary ? 0 : 1)"'

check 'Volumen de medios escribible por la API' \
  "${compose[@]}" exec -T api-sorteos sh -ec \
  'test -d /app/uploads/media && test -w /app/uploads/media'

if [[ "${diagnostic_failed}" == true ]]; then
  exit 1
fi

printf '%s\n' 'Todos los controles pasaron.'
