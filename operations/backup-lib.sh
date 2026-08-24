#!/usr/bin/env bash

# Biblioteca compartida por las operaciones de backup. Los scripts que la
# cargan deben activar set -Eeuo pipefail y definir env_file.

operations_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${operations_dir}/.." && pwd)"
: "${env_file:?El script llamador debe definir env_file antes de cargar backup-lib.sh}"

ops_fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

ops_require_command() {
  command -v "$1" >/dev/null 2>&1 || ops_fail "Se requiere el comando $1"
}

ops_file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

ops_require_private_file() {
  local path="$1"
  local description="$2"
  local mode_value
  local mode_number
  [[ -f "${path}" && ! -L "${path}" ]] \
    || ops_fail "No se encontró ${description} o es un enlace simbólico"
  mode_value="$(ops_file_mode "${path}")"
  mode_number=$((8#${mode_value}))
  (( (mode_number & 077) == 0 )) \
    || ops_fail "${description} debe tener permisos 0600 o más restrictivos (modo ${mode_value})"
}

ops_env_value() {
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

ops_config_value() {
  local variable_name="$1"
  local fallback="${2:-}"
  local environment_value="${!variable_name-}"
  if [[ -n "${environment_value}" ]]; then
    printf '%s\n' "${environment_value}"
    return
  fi
  local file_value
  file_value="$(ops_env_value "${variable_name}")"
  printf '%s\n' "${file_value:-${fallback}}"
}

ops_absolute_path() {
  local configured="$1"
  if [[ "${configured}" = /* ]]; then
    printf '%s\n' "${configured}"
  else
    printf '%s/%s\n' "${project_dir}" "${configured#./}"
  fi
}

ops_prepare_private_directory() {
  local path="$1"
  local description="$2"
  [[ ! -L "${path}" ]] || ops_fail "${description} no puede ser un enlace simbólico"
  mkdir -p -- "${path}"
  [[ -d "${path}" ]] || ops_fail "No se pudo crear ${description}"
  chmod 700 "${path}"
}

ops_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    ops_fail 'Se requiere sha256sum o shasum'
  fi
}

ops_manifest_value() {
  local manifest="$1"
  local key="$2"
  awk -F= -v wanted="${key}" '$1 == wanted { sub("^[^=]*=", ""); print; exit }' \
    "${manifest}"
}

ops_validate_checksum() {
  local archive="$1"
  local checksum_file="${archive}.sha256"
  [[ -f "${checksum_file}" && ! -L "${checksum_file}" ]] \
    || ops_fail "Falta ${checksum_file}"
  local expected
  local actual
  expected="$(awk 'NF { print $1; exit }' "${checksum_file}")"
  [[ "${expected}" =~ ^[0-9a-fA-F]{64}$ ]] \
    || ops_fail 'El checksum externo no tiene un SHA-256 válido'
  actual="$(ops_sha256 "${archive}")"
  actual="$(printf '%s' "${actual}" | tr 'A-F' 'a-f')"
  expected="$(printf '%s' "${expected}" | tr 'A-F' 'a-f')"
  [[ "${actual}" == "${expected}" ]] \
    || ops_fail 'El checksum externo del backup no coincide'
}

ops_unpack_and_verify() {
  local archive="$1"
  local destination="$2"
  local identity_file="$3"
  local allow_unencrypted="$4"
  local bundle="${destination}/bundle.tar"

  [[ -f "${archive}" && ! -L "${archive}" ]] \
    || ops_fail 'El backup no existe o es un enlace simbólico'
  ops_validate_checksum "${archive}"
  ops_prepare_private_directory "${destination}" 'el directorio temporal de verificación'

  case "${archive}" in
    *.age)
      ops_require_command age
      [[ -n "${identity_file}" ]] \
        || ops_fail 'Configure BACKUP_AGE_IDENTITY_FILE para descifrar el backup'
      identity_file="$(ops_absolute_path "${identity_file}")"
      ops_require_private_file "${identity_file}" 'la identidad age de backup'
      age --decrypt --identity "${identity_file}" --output "${bundle}" "${archive}"
      ;;
    *.tar)
      [[ "${allow_unencrypted}" == true ]] \
        || ops_fail 'El backup no está cifrado; use --allow-unencrypted sólo para una copia deliberada'
      cp -- "${archive}" "${bundle}"
      ;;
    *)
      ops_fail 'Formato de backup no reconocido; se esperaba .tar.age o .tar'
      ;;
  esac

  chmod 600 "${bundle}"
  local listing
  listing="$(tar -tf "${bundle}" | LC_ALL=C sort)"
  [[ "${listing}" == $'manifest.txt\nmedia.tar.gz\nmongo.archive.gz' ]] \
    || ops_fail 'El bundle contiene entradas inesperadas o está incompleto'
  tar -xf "${bundle}" -C "${destination}"
  rm -f -- "${bundle}"

  local manifest="${destination}/manifest.txt"
  [[ "$(ops_manifest_value "${manifest}" format)" == 'api-sorteos-backup-v1' ]] \
    || ops_fail 'La versión del manifiesto no es compatible'
  local database
  database="$(ops_manifest_value "${manifest}" database)"
  [[ "${database}" =~ ^[A-Za-z0-9_-]{1,64}$ ]] \
    || ops_fail 'El nombre de base del manifiesto no es válido'

  local expected_mongo
  local expected_media
  expected_mongo="$(ops_manifest_value "${manifest}" mongo_sha256)"
  expected_media="$(ops_manifest_value "${manifest}" media_sha256)"
  [[ "$(ops_sha256 "${destination}/mongo.archive.gz")" == "${expected_mongo}" ]] \
    || ops_fail 'El volcado Mongo no coincide con el manifiesto'
  [[ "$(ops_sha256 "${destination}/media.tar.gz")" == "${expected_media}" ]] \
    || ops_fail 'El archivo de medios no coincide con el manifiesto'

  gzip -t "${destination}/mongo.archive.gz"
  tar -tzf "${destination}/media.tar.gz" >/dev/null
  if tar -tzf "${destination}/media.tar.gz" | awk '
      /^\// || $0 == ".." || /^\.\.\// || /\/\.\.\// || /\/\.\.$/ { bad = 1 }
      END { exit bad }
    '; then
    :
  else
    ops_fail 'El archivo de medios contiene una ruta insegura'
  fi
  if tar -tvzf "${destination}/media.tar.gz" | awk '
      substr($0, 1, 1) == "l" || substr($0, 1, 1) == "h" { bad = 1 }
      END { exit bad }
    '; then
    :
  else
    ops_fail 'El archivo de medios contiene enlaces y no es restaurable de forma segura'
  fi
}
