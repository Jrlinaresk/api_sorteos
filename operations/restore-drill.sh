#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

operations_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${operations_dir}/.." && pwd)"
env_file="${project_dir}/.env.server"
identity_override=''
allow_unencrypted=false
cleanup_after=false

usage() {
  printf 'Uso: %s [--env-file RUTA] [--identity-file RUTA] [--allow-unencrypted] [--cleanup] BACKUP\n' "${0##*/}"
}

archive=''
while (($#)); do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --env-file\n' >&2; exit 2; }
      if [[ "$2" = /* ]]; then env_file="$2"; else env_file="${project_dir}/$2"; fi
      shift 2
      ;;
    --identity-file)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --identity-file\n' >&2; exit 2; }
      identity_override="$2"
      shift 2
      ;;
    --allow-unencrypted)
      allow_unencrypted=true
      shift
      ;;
    --cleanup)
      cleanup_after=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -* )
      printf 'Opción desconocida: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      [[ -z "${archive}" ]] || { usage >&2; exit 2; }
      archive="$1"
      shift
      ;;
  esac
done

[[ -n "${archive}" ]] || { usage >&2; exit 2; }
if [[ "${archive}" != /* ]]; then archive="${PWD}/${archive}"; fi

# shellcheck disable=SC1091
source "${operations_dir}/backup-lib.sh"
ops_require_private_file "${env_file}" 'el archivo de entorno'
ops_require_command docker
ops_require_command tar
ops_require_command gzip
identity_file="${identity_override:-$(ops_config_value BACKUP_AGE_IDENTITY_FILE)}"
temporary="$(mktemp -d)"
run_id="$(date -u +%Y%m%d%H%M%S)-$$"
mongo_container="api-sorteos-restore-${run_id}"
mongo_volume="api-sorteos-restore-mongo-${run_id}"
media_volume="api-sorteos-restore-media-${run_id}"
container_created=false

stop_drill_container() {
  if [[ "${container_created}" == true ]]; then
    docker stop --time 30 "${mongo_container}" >/dev/null 2>&1 || true
  fi
}
trap 'stop_drill_container; rm -rf -- "${temporary}"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ops_unpack_and_verify "${archive}" "${temporary}/verified" "${identity_file}" "${allow_unencrypted}"
database="$(ops_manifest_value "${temporary}/verified/manifest.txt" database)"

docker volume create "${mongo_volume}" >/dev/null
docker volume create "${media_volume}" >/dev/null
docker run -d --name "${mongo_container}" --network none \
  --volume "${mongo_volume}:/data/db" mongo:7.0 \
  mongod --bind_ip_all >/dev/null
container_created=true

for attempt in $(seq 1 60); do
  if docker exec "${mongo_container}" mongosh --quiet --host 127.0.0.1 \
    --eval 'quit(db.adminCommand("ping").ok ? 0 : 1)' >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" -eq 60 ]]; then
    ops_fail 'MongoDB aislado no quedó listo dentro del plazo'
  fi
  sleep 1
done

docker exec -i "${mongo_container}" mongorestore --quiet --archive --gzip \
  < "${temporary}/verified/mongo.archive.gz"
docker run --rm --network none --read-only -i \
  --volume "${media_volume}:/data" alpine:3.20 \
  sh -ec 'exec tar -C /data -xzf -' \
  < "${temporary}/verified/media.tar.gz"

stats="$(docker exec "${mongo_container}" mongosh --quiet --host 127.0.0.1 \
  --eval "JSON.stringify(db.getSiblingDB('${database}').stats())")"
[[ "${stats}" == *'"ok":1'* ]] || ops_fail 'La base restaurada no superó db.stats()'
stop_drill_container

if [[ "${cleanup_after}" == true ]]; then
  docker rm "${mongo_container}" >/dev/null
  container_created=false
  docker volume rm "${mongo_volume}" "${media_volume}" >/dev/null
  printf '%s\n' 'Simulacro correcto; se eliminaron únicamente sus recursos aislados (--cleanup).'
else
  printf '%s\n' 'Simulacro correcto. Producción no fue modificada.'
  printf 'Contenedor detenido: %s\nVolumen Mongo: %s\nVolumen medios: %s\n' \
    "${mongo_container}" "${mongo_volume}" "${media_volume}"
  printf 'Para eliminarlos tras inspeccionarlos: docker rm %q && docker volume rm %q %q\n' \
    "${mongo_container}" "${mongo_volume}" "${media_volume}"
fi
