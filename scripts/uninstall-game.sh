#!/usr/bin/env bash
# Stop and remove the Terra en disputa service and application; games stay unless --purge.
set -Eeuo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
usage() {
  cat <<'USAGE'
Uso: bash scripts/uninstall-game.sh [opciones]

Detiene y borra ted.service y la aplicación instalada.
Las partidas y los respaldos se conservan, salvo con --purge.

--install-dir CARPETA  Instalación; predeterminado: ~/ted.
--data-dir CARPETA     Datos a borrar con --purge; por defecto, los del servicio.
--user-service         Servicio systemd personal, sin sudo.
--purge                Borra también las partidas y los respaldos.
--yes                  No pide confirmación.
-h, --help             Ayuda.
USAGE
}

install_dir=$HOME/ted
data_dir=
personal=false
purge=false
confirmed=false
while (($#)); do
  case "$1" in
    --user-service) personal=true; shift ;;
    --purge) purge=true; shift ;;
    --yes) confirmed=true; shift ;;
    --install-dir|--data-dir)
      if (($# < 2)) || [[ -z $2 || $2 == --* ]]; then die "Falta el valor de $1."; fi
      [[ $1 == --install-dir ]] && install_dir=$2 || data_dir=$2
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opción desconocida: $1. Consultá --help." ;;
  esac
done
((EUID != 0)) || die 'Ejecutalo con tu usuario habitual, sin sudo delante del script.'
install_dir=$(realpath -m -- "$install_dir")
backup_root=${install_dir}-backups
[[ $install_dir != / && $install_dir != "$HOME" ]] || die 'La carpeta de instalación no puede ser / ni tu carpeta personal.'

service=ted.service
if $personal; then
  ctl=(systemctl --user)
  inspect=(systemctl --user)
  admin=()
else
  ctl=(sudo systemctl)
  inspect=(systemctl)
  admin=(sudo)
fi

load_state=$("${inspect[@]}" show "$service" -p LoadState --value 2>/dev/null) || load_state=not-found
fragment=
if [[ $load_state != not-found ]]; then
  fragment=$("${inspect[@]}" show "$service" -p FragmentPath --value)
  if [[ -z $data_dir ]]; then
    # The unit written by install-game.sh passes --data-dir explicitly.
    exec_start=$("${inspect[@]}" show "$service" -p ExecStart --value)
    if [[ $exec_start =~ --data-dir\ ([^\ \;]+) ]]; then data_dir=${BASH_REMATCH[1]}; fi
  fi
fi
[[ -n $data_dir ]] || data_dir=${XDG_DATA_HOME:-$HOME/.local/share}/ted
data_dir=$(realpath -m -- "$data_dir")
[[ $data_dir != / && $data_dir != "$HOME" ]] || die 'La carpeta de datos no puede ser / ni tu carpeta personal.'

say 'Se va a borrar:'
[[ -n $fragment ]] && say "  servicio:   $fragment (y sus ajustes en $service.d)"
[[ -e $install_dir ]] && say "  aplicación: $install_dir"
if $purge; then
  [[ -e $data_dir ]] && say "  partidas:   $data_dir"
  [[ -e $backup_root ]] && say "  respaldos:  $backup_root"
else
  say "Se conservan las partidas ($data_dir) y los respaldos ($backup_root)."
fi
if ! $confirmed; then
  [[ -t 0 ]] || die 'Confirmá con --yes cuando no hay una terminal interactiva.'
  read -r -p 'Continuar? [s/N] ' answer
  [[ $answer == [sS] ]] || die 'Cancelado.'
fi

if [[ -n $fragment ]]; then
  "${ctl[@]}" disable --now "$service" || true
  "${admin[@]}" rm -f -- "$fragment"
  "${admin[@]}" rm -rf -- "$(dirname -- "$fragment")/$service.d"
  "${ctl[@]}" daemon-reload
  "${ctl[@]}" reset-failed "$service" >/dev/null 2>&1 || true
fi
rm -rf -- "$install_dir"
if $purge; then rm -rf -- "$data_dir" "$backup_root"; fi
say 'Terra en disputa quedó desinstalado.'
