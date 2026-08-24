#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${script_dir}/.env.docker.local"
follow_logs=false

while (($#)); do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --env-file\n' >&2; exit 2; }
      if [[ "$2" = /* ]]; then env_file="$2"; else env_file="${script_dir}/$2"; fi
      shift 2
      ;;
    --follow)
      follow_logs=true
      shift
      ;;
    -h|--help)
      printf 'Uso: %s [--env-file RUTA] [--follow]\n' "${0##*/}"
      exit 0
      ;;
    *)
      printf 'Opción desconocida: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || { printf 'Docker no está instalado.\n' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { printf 'Se requiere Docker Compose v2.\n' >&2; exit 1; }

if [[ ! -f "${env_file}" ]]; then
  "${script_dir}/setup-env.sh" --development --output "${env_file}"
fi

cd -- "${script_dir}"
compose=(docker compose --env-file "${env_file}" -f docker-compose.yml)
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --remove-orphans --wait --wait-timeout 180
"${compose[@]}" ps

if [[ "${follow_logs}" == true ]]; then
  "${compose[@]}" logs -f api-sorteos
fi
