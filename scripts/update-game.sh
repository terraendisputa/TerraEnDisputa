#!/usr/bin/env bash
# Update public source and build a portable Terra en disputa package.
set -Eeuo pipefail

# Messages come in Spanish and English; the system language picks one.
case ${LC_ALL:-${LC_MESSAGES:-${LANG:-}}} in es|es[_.@-]*) spanish=true ;; *) spanish=false ;; esac
pick() { if $spanish || (($# == 1)); then printf '%s' "$1"; else printf '%s' "$2"; fi; }
die() { printf 'ERROR: %s\n' "$(pick "$@")" >&2; exit 1; }
usage() {
  if $spanish; then
    cat <<'USAGE'
Uso: bash scripts/update-game.sh [--build | --pull] [--dir CARPETA]

--build  Compila el código local y verifica el paquete (opción predeterminada).
--pull   Actualiza main desde el repositorio público HTTPS y después compila.
--dir    Carpeta del código fuente; por defecto, el proyecto de este script.

Requisitos: Node.js >=24.11 y <25, pnpm 10.15.0; Git solo para --pull.
Salida: release/ del proyecto. No instala el paquete ni administra servicios.
TED_BUILD_MEMORY_MB permite cambiar el heap de Node (predeterminado: 512).
USAGE
  else
    cat <<'USAGE'
Usage: bash scripts/update-game.sh [--build | --pull] [--dir FOLDER]

--build  Build the local code and verify the package (default).
--pull   Update main from the public HTTPS repository, then build.
--dir    Source code folder; defaults to this script's project.

Requirements: Node.js >=24.11 and <25, pnpm 10.15.0; Git only for --pull.
Output: the project's release/ folder. It does not install the package or manage services.
TED_BUILD_MEMORY_MB changes the Node heap (default: 512).
USAGE
  fi
}

mode=build
mode_selected=false
project_dir=
while (($#)); do
  case "$1" in
    --build|--pull)
      $mode_selected && die 'Elegí --build o --pull, no ambos.' 'Choose --build or --pull, not both.'
      mode=${1#--}
      mode_selected=true
      shift
      ;;
    --dir)
      if (($# < 2)) || [[ -z $2 ]]; then
        die 'Falta la carpeta de --dir.' 'Missing folder for --dir.'
      fi
      [[ -z $project_dir ]] || die '--dir solo puede indicarse una vez.' '--dir may be given only once.'
      project_dir=$2
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opción desconocida: $1. Consultá --help." "Unknown option: $1. See --help." ;;
  esac
done
if [[ -z $project_dir ]]; then
  project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fi
[[ -d $project_dir ]] || die 'La carpeta del proyecto no existe.' 'The project folder does not exist.'
cd -- "$project_dir"
project_dir=$(pwd -P)
[[ -f package.json && -f pnpm-lock.yaml && -f scripts/release-build.mjs && -f scripts/release-smoke.mjs ]] || die 'La carpeta no contiene el código fuente completo de Terra en disputa.' 'The folder does not contain the complete Terra en disputa source code.'

command -v node >/dev/null || die 'Instalá Node.js >=24.11 y <25.' 'Install Node.js >=24.11 and <25.'
command -v pnpm >/dev/null || die 'Instalá pnpm 10.15.0.' 'Install pnpm 10.15.0.'
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a===24 && b>=11 ? 0 : 1)' || die 'Se necesita Node.js >=24.11 y <25.' 'Node.js >=24.11 and <25 is required.'
[[ $(pnpm --version) == 10.15.0 ]] || die 'Se necesita pnpm 10.15.0.' 'pnpm 10.15.0 is required.'
node -e 'process.exit(["linux","win32"].includes(process.platform) && process.arch === "x64" ? 0 : 1)' || die 'El empaquetado actual admite Linux x64 y Windows x64 con Node nativo.' 'Packaging currently supports Linux x64 and Windows x64 with native Node.'

memory=${TED_BUILD_MEMORY_MB:-512}
if [[ ! $memory =~ ^[1-9][0-9]{2,3}$ ]] || ((memory < 128 || memory > 8192)); then
  die 'TED_BUILD_MEMORY_MB debe estar entre 128 y 8192.' 'TED_BUILD_MEMORY_MB must be between 128 and 8192.'
fi

if [[ $mode == pull ]]; then
  command -v git >/dev/null || die 'Instalá Git para usar --pull.' 'Install Git to use --pull.'
  [[ $(git rev-parse --show-toplevel) == "$project_dir" ]] || die '--pull requiere la raíz de un checkout de Git.' '--pull requires the root of a Git checkout.'
  [[ $(git branch --show-current) == main ]] || die '--pull requiere estar en la rama main.' '--pull requires the main branch.'
  [[ -z $(git status --porcelain) ]] || die 'Hay cambios locales. Guardalos antes de usar --pull; no se sobrescribirán.' 'There are local changes. Save them before using --pull; they will not be overwritten.'
  # Use the public HTTPS URL, regardless of an existing SSH origin.
  repository=$(node -e '
    const p=require("./package.json");
    if (!p.repository?.url) process.exit(1);
    const u=new URL(p.repository.url);
    if(u.protocol!=="https:" || u.username || u.password || u.search || u.hash) process.exit(1);
    console.log(u.href);
  ') || die 'Falta configurar repository.url en package.json con la URL pública HTTPS definitiva, sin credenciales. Podés usar --build mientras tanto.' 'repository.url in package.json must be set to the final public HTTPS URL, without credentials. You can use --build meanwhile.'
  printf '%s\n' "$(pick 'Actualizando main desde el repositorio público…' 'Updating main from the public repository…')"
  if ! GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=false git \
    -c credential.helper= -c core.askPass=false \
    pull --ff-only --no-rebase "$repository" main; then
    die 'No se pudo actualizar. Comprobá la red, el acceso público y que main no haya divergido. Podés compilar la copia local con --build.' 'Could not update. Check the network, public access and that main has not diverged. You can build the local copy with --build.'
  fi
  [[ $(git rev-parse HEAD) == "$(git rev-parse FETCH_HEAD)" ]] || die 'Hay commits locales que no están en main remoto. No se compilará como actualización pública.' 'There are local commits that are not on the remote main. It will not be built as a public update.'
  printf 'Commit: %s\n' "$(git rev-parse --short HEAD)"
fi

printf "$(pick 'Compilando Terra en disputa (heap de Node: %s MB, paquetes secuenciales)…' 'Building Terra en disputa (Node heap: %s MB, sequential packages)…')\n" "$memory"
export NODE_OPTIONS="--max-old-space-size=$memory"
# The package check talks to its own local server; never route that through a proxy.
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"
# The desktop app is built only for its own packages, never on a server.
CI=true pnpm install --frozen-lockfile --filter '!@game/desktop'
pnpm --workspace-concurrency=1 -r --if-present build
node scripts/release-build.mjs
node scripts/release-smoke.mjs
printf "\n$(pick 'Paquete generado y verificado en: %s/release/' 'Package built and verified in: %s/release/')\n" "$project_dir"
