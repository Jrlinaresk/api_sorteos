#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

operations_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${operations_dir}/.." && pwd)"
env_file="${project_dir}/.env.server"
identity_override=''
allow_unencrypted=false

usage() {
  printf 'Uso: %s [--env-file RUTA] [--identity-file RUTA] [--allow-unencrypted] BACKUP\n' "${0##*/}"
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
ops_require_command tar
ops_require_command gzip
identity_file="${identity_override:-$(ops_config_value BACKUP_AGE_IDENTITY_FILE)}"
temporary="$(mktemp -d)"
trap 'rm -rf -- "${temporary}"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ops_unpack_and_verify "${archive}" "${temporary}/verified" "${identity_file}" "${allow_unencrypted}"

printf 'Backup íntegro: %s\n' "${archive}"
printf 'Creado: %s; base: %s; revisión: %s\n' \
  "$(ops_manifest_value "${temporary}/verified/manifest.txt" created_at)" \
  "$(ops_manifest_value "${temporary}/verified/manifest.txt" database)" \
  "$(ops_manifest_value "${temporary}/verified/manifest.txt" git_revision)"
