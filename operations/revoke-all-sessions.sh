#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

operations_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "${operations_dir}/.." && pwd)"
env_file="${project_dir}/.env.server"
confirmation=''

usage() {
  printf 'Uso: %s [--env-file RUTA] --confirm REVOKE-ALL-SESSIONS\n' "${0##*/}"
}

while (($#)); do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || { printf 'Falta la ruta para --env-file\n' >&2; exit 2; }
      if [[ "$2" = /* ]]; then env_file="$2"; else env_file="${project_dir}/$2"; fi
      shift 2
      ;;
    --confirm)
      [[ $# -ge 2 ]] || { printf 'Falta el texto para --confirm\n' >&2; exit 2; }
      confirmation="$2"
      shift 2
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

[[ "${confirmation}" == 'REVOKE-ALL-SESSIONS' ]] || {
  printf '%s\n' 'Esta operación cierra todas las sesiones. Falta la confirmación exacta.' >&2
  usage >&2
  exit 2
}

# shellcheck disable=SC1091
source "${operations_dir}/backup-lib.sh"
ops_require_private_file "${env_file}" 'el archivo de entorno'
ops_require_command docker
compose=(docker compose --env-file "${env_file}" -f "${project_dir}/docker-compose.prod.yml")
"${compose[@]}" config --quiet
api_was_running=false
api_restarted=false

restart_api() {
  if [[ "${api_was_running}" == true && "${api_restarted}" != true ]]; then
    "${compose[@]}" start api-sorteos >/dev/null
    api_restarted=true
  fi
}
trap 'restart_api || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if "${compose[@]}" ps --status running --services | grep -Fxq api-sorteos; then
  api_was_running=true
  printf '%s\n' 'Pausando brevemente la API para cerrar la carrera de nuevas sesiones...'
  "${compose[@]}" stop --timeout 60 api-sorteos >/dev/null
fi

# Las variables y el JavaScript se expanden deliberadamente en mongosh dentro
# del contenedor, no en el host.
# shellcheck disable=SC2016
"${compose[@]}" exec -T mongodb /bin/bash -ec '
  exec mongosh --quiet --host 127.0.0.1 \
    --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" \
    --authenticationDatabase admin \
    --eval '\''
      const database = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE);
      const now = new Date();
      const users = database.users.updateMany({}, { $inc: { authVersion: 1 } });
      const sessions = database.refresh_sessions.updateMany(
        { revokedAt: { $exists: false } },
        { $set: { revokedAt: now, revokeReason: "Revocación operativa global" } }
      );
      printjson({
        usersInvalidated: users.modifiedCount,
        refreshSessionsRevoked: sessions.modifiedCount,
        completedAt: now
      });
    '\''
'

restart_api
printf '%s\n' 'Todas las versiones de autenticación y refresh sessions fueron invalidadas.'
