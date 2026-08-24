#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

operations_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${operations_dir}/.." && pwd)"
env_file="${project_dir}/.env.server"
output_override=''
allow_unencrypted=false
skip_offsite=false

usage() {
  printf 'Uso: %s [--env-file RUTA] [--output-dir RUTA] [--allow-unencrypted] [--no-offsite]\n' "${0##*/}"
}

while (($#)); do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --env-file\n' >&2; exit 2; }
      if [[ "$2" = /* ]]; then env_file="$2"; else env_file="${project_dir}/$2"; fi
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --output-dir\n' >&2; exit 2; }
      output_override="$2"
      shift 2
      ;;
    --allow-unencrypted)
      allow_unencrypted=true
      shift
      ;;
    --no-offsite)
      skip_offsite=true
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

# shellcheck disable=SC1091
source "${operations_dir}/backup-lib.sh"

ops_require_private_file "${env_file}" 'el archivo de entorno'
ops_require_command docker
ops_require_command tar
ops_require_command gzip
docker compose version >/dev/null 2>&1 \
  || ops_fail 'Se requiere Docker Compose v2'

database="$(ops_config_value MONGO_DATABASE api_sorteos)"
[[ "${database}" =~ ^[A-Za-z0-9_-]{1,64}$ ]] \
  || ops_fail 'MONGO_DATABASE sólo admite letras, números, guion y guion bajo'

configured_output="${output_override:-$(ops_config_value BACKUP_LOCAL_DIR ./runtime/backups)}"
backup_dir="$(ops_absolute_path "${configured_output}")"
ops_prepare_private_directory "${backup_dir}" 'el directorio local de backups'

recipient="$(ops_config_value BACKUP_AGE_RECIPIENT)"
if [[ -z "${recipient}" && "${allow_unencrypted}" != true ]]; then
  ops_fail 'Configure BACKUP_AGE_RECIPIENT o use --allow-unencrypted de forma explícita'
fi
if [[ -n "${recipient}" ]]; then
  ops_require_command age
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d "${backup_dir}/.backup-${timestamp}.XXXXXX")"
bundle="${stage}/api-sorteos-${timestamp}.tar"
temporary_artifact=''
api_was_running=false
api_restarted=false
compose=(docker compose --env-file "${env_file}" -f "${project_dir}/docker-compose.prod.yml")

restart_api() {
  if [[ "${api_was_running}" == true && "${api_restarted}" != true ]]; then
    printf '%s\n' 'Reiniciando la API después de la ventana de backup...'
    "${compose[@]}" start api-sorteos >/dev/null
    api_restarted=true
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  restart_api || true
  if [[ -n "${temporary_artifact}" && -f "${temporary_artifact}" ]]; then
    rm -f -- "${temporary_artifact}"
  fi
  rm -rf -- "${stage}"
  exit "${exit_code}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${compose[@]}" config --quiet
if "${compose[@]}" ps --status running --services | grep -Fxq api-sorteos; then
  api_was_running=true
  printf '%s\n' 'Pausando la API para alinear el volcado Mongo con los medios...'
  "${compose[@]}" stop --timeout 60 api-sorteos >/dev/null
else
  printf '%s\n' 'La API ya estaba detenida; no se iniciará al finalizar.'
fi

printf '%s\n' 'Creando volcado de la base de aplicación...'
# Las variables se expanden deliberadamente dentro del contenedor Mongo.
# shellcheck disable=SC2016
"${compose[@]}" exec -T mongodb /bin/bash -ec \
  'exec mongodump --quiet --host 127.0.0.1 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db "$MONGO_INITDB_DATABASE" --readPreference primary --archive --gzip' \
  > "${stage}/mongo.archive.gz"

printf '%s\n' 'Archivando el volumen de medios en modo de sólo lectura...'
"${compose[@]}" run --rm --no-deps -T --entrypoint /bin/sh api-sorteos \
  -ec 'exec tar -C /app/uploads/media -czf - .' \
  > "${stage}/media.tar.gz"

restart_api

gzip -t "${stage}/mongo.archive.gz"
tar -tzf "${stage}/media.tar.gz" >/dev/null
mongo_sha="$(ops_sha256 "${stage}/mongo.archive.gz")"
media_sha="$(ops_sha256 "${stage}/media.tar.gz")"
git_revision="$(git -C "${project_dir}" rev-parse --verify HEAD 2>/dev/null || printf 'unknown')"
[[ "${git_revision}" =~ ^[0-9a-f]{40}$ ]] || git_revision=unknown
printf '%s\n' \
  'format=api-sorteos-backup-v1' \
  "created_at=${timestamp}" \
  "database=${database}" \
  "git_revision=${git_revision}" \
  "mongo_sha256=${mongo_sha}" \
  "media_sha256=${media_sha}" \
  > "${stage}/manifest.txt"

tar -C "${stage}" -cf "${bundle}" manifest.txt media.tar.gz mongo.archive.gz

base_name="api-sorteos-${timestamp}.tar"
temporary_artifact="${backup_dir}/.${base_name}.partial.$$"
if [[ -n "${recipient}" ]]; then
  base_name="${base_name}.age"
  temporary_artifact="${backup_dir}/.${base_name}.partial.$$"
  age --encrypt --recipient "${recipient}" --output "${temporary_artifact}" "${bundle}"
else
  cp -- "${bundle}" "${temporary_artifact}"
fi
chmod 600 "${temporary_artifact}"
artifact="${backup_dir}/${base_name}"
[[ ! -e "${artifact}" ]] || ops_fail 'Ya existe un backup con la misma marca temporal'
mv -- "${temporary_artifact}" "${artifact}"
artifact_sha="$(ops_sha256 "${artifact}")"
printf '%s  %s\n' "${artifact_sha}" "${base_name}" > "${artifact}.sha256"
chmod 600 "${artifact}.sha256"

if [[ "${skip_offsite}" != true ]]; then
  offsite_dir="$(ops_config_value BACKUP_OFFSITE_DIR)"
  if [[ -n "${offsite_dir}" ]]; then
    offsite_dir="$(ops_absolute_path "${offsite_dir}")"
    ops_prepare_private_directory "${offsite_dir}" 'el directorio off-site'
    for source_path in "${artifact}" "${artifact}.sha256"; do
      target_name="$(basename -- "${source_path}")"
      partial="${offsite_dir}/.${target_name}.partial.$$"
      install -m 600 "${source_path}" "${partial}"
      mv -- "${partial}" "${offsite_dir}/${target_name}"
    done
  fi

  rclone_remote="$(ops_config_value BACKUP_RCLONE_REMOTE)"
  if [[ -n "${rclone_remote}" ]]; then
    ops_require_command rclone
    rclone copyto --quiet "${artifact}" "${rclone_remote%/}/${base_name}"
    rclone copyto --quiet "${artifact}.sha256" "${rclone_remote%/}/${base_name}.sha256"
  fi
fi

printf 'Backup creado y verificado: %s\n' "${artifact}"
if [[ -z "$(ops_config_value BACKUP_OFFSITE_DIR)" && -z "$(ops_config_value BACKUP_RCLONE_REMOTE)" ]]; then
  printf '%s\n' 'Aviso: no hay destino off-site configurado; esta copia permanece en el host.'
fi
