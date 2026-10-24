#!/usr/bin/env bash
# Update public source and build a portable Terra en disputa package.
set -Eeuo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Uso: bash scripts/update-game.sh [--build | --pull] [--dir CARPETA]

--build  Compila el código local y verifica el paquete (opción predeterminada).
--pull   Actualiza main desde el repositorio público HTTPS y después compila.
--dir    Carpeta del código fuente; por defecto, el proyecto de este script.

Requisitos: Node.js >=24.11 y <25, pnpm 10.15.0; Git solo para --pull.
Salida: release/ del proyecto. No instala el paquete ni administra servicios.
TED_BUILD_MEMORY_MB permite cambiar el heap de Node (predeterminado: 512).
USAGE
}

mode=build
mode_selected=false
project_dir=
while (($#)); do
  case "$1" in
    --build|--pull)
      $mode_selected && die 'Elegí --build o --pull, no ambos.'
      mode=${1#--}
      mode_selected=true
      shift
      ;;
    --dir)
      if (($# < 2)) || [[ -z $2 ]]; then
        die 'Falta la carpeta de --dir.'
      fi
      [[ -z $project_dir ]] || die '--dir solo puede indicarse una vez.'
      project_dir=$2
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opción desconocida: $1. Consultá --help." ;;
  esac
done
if [[ -z $project_dir ]]; then
  project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fi
[[ -d $project_dir ]] || die 'La carpeta del proyecto no existe.'
cd -- "$project_dir"
project_dir=$(pwd -P)
[[ -f package.json && -f pnpm-lock.yaml && -f scripts/release-build.mjs && -f scripts/release-smoke.mjs ]] || die 'La carpeta no contiene el código fuente completo de Terra en disputa.'

command -v node >/dev/null || die 'Instalá Node.js >=24.11 y <25.'
command -v pnpm >/dev/null || die 'Instalá pnpm 10.15.0.'
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a===24 && b>=11 ? 0 : 1)' || die 'Se necesita Node.js >=24.11 y <25.'
[[ $(pnpm --version) == 10.15.0 ]] || die 'Se necesita pnpm 10.15.0.'
node -e 'process.exit(["linux","win32"].includes(process.platform) && process.arch === "x64" ? 0 : 1)' || die 'El empaquetado actual admite Linux x64 y Windows x64 con Node nativo.'

memory=${TED_BUILD_MEMORY_MB:-512}
if [[ ! $memory =~ ^[1-9][0-9]{2,3}$ ]] || ((memory < 128 || memory > 8192)); then
  die 'TED_BUILD_MEMORY_MB debe estar entre 128 y 8192.'
fi

if [[ $mode == pull ]]; then
  command -v git >/dev/null || die 'Instalá Git para usar --pull.'
  [[ $(git rev-parse --show-toplevel) == "$project_dir" ]] || die '--pull requiere la raíz de un checkout de Git.'
  [[ $(git branch --show-current) == main ]] || die '--pull requiere estar en la rama main.'
  [[ -z $(git status --porcelain) ]] || die 'Hay cambios locales. Guardalos antes de usar --pull; no se sobrescribirán.'
  # Use the public HTTPS URL, regardless of an existing SSH origin.
  repository=$(node -e '
    const p=require("./package.json");
    if (!p.repository?.url) process.exit(1);
    const u=new URL(p.repository.url);
    if(u.protocol!=="https:" || u.username || u.password || u.search || u.hash) process.exit(1);
    console.log(u.href);
  ') || die 'Falta configurar repository.url en package.json con la URL pública HTTPS definitiva, sin credenciales. Podés usar --build mientras tanto.'
  printf 'Actualizando main desde el repositorio público…\n'
  if ! GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=false git \
    -c credential.helper= -c core.askPass=false \
    pull --ff-only --no-rebase "$repository" main; then
    die 'No se pudo actualizar. Comprobá la red, el acceso público y que main no haya divergido. Podés compilar la copia local con --build.'
  fi
  [[ $(git rev-parse HEAD) == "$(git rev-parse FETCH_HEAD)" ]] || die 'Hay commits locales que no están en main remoto. No se compilará como actualización pública.'
  printf 'Commit: %s\n' "$(git rev-parse --short HEAD)"
fi

printf 'Compilando Terra en disputa (heap de Node: %s MB, paquetes secuenciales)…\n' "$memory"
export NODE_OPTIONS="--max-old-space-size=$memory"
# The package check talks to its own local server; never route that through a proxy.
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"
CI=true pnpm install --frozen-lockfile
pnpm --workspace-concurrency=1 -r --if-present build
node scripts/release-build.mjs
node scripts/release-smoke.mjs
printf '\nPaquete generado y verificado en: %s/release/\n' "$project_dir"
