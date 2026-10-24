#!/usr/bin/env bash
# Compile a portable package, install it, and run it through systemd on Linux.
set -Eeuo pipefail
umask 077

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
usage() {
  cat <<'USAGE'
Uso: bash scripts/install-game.sh [opciones]

Compila, verifica, instala y habilita ted.service en Linux x64.
Ejecutar con el usuario que jugará/alojará el servidor, sin sudo delante.

--pull                 Actualiza main público antes de compilar.
--dir CARPETA          Carpeta fuente; por defecto, el proyecto del script.
--install-dir CARPETA  Instalación; predeterminado: ~/ted.
--data-dir CARPETA     Datos; predeterminado: XDG_DATA_HOME/ted
                      o ~/.local/share/ted.
--bind DIRECCIÓN      Escucha inicial; predeterminado: 127.0.0.1.
--port NÚMERO         Puerto inicial; predeterminado: 3000.
--user-service        Servicio systemd personal, sin sudo.
-h, --help            Ayuda.

Una unidad existente compatible se conserva, incluyendo su configuración.
--bind/--port/--data-dir son para unidades nuevas; editar las existentes aparte.
TED_BUILD_MEMORY_MB configura el heap de compilación (512 MB por defecto).
USAGE
}

project_dir=
install_dir=$HOME/ted
data_dir=${XDG_DATA_HOME:-$HOME/.local/share}/ted
bind=127.0.0.1
port=3000
mode=--build
personal=false
settings_supplied=false
while (($#)); do
  case "$1" in
    --pull) mode=--pull; shift ;;
    --user-service) personal=true; shift ;;
    --dir|--install-dir|--data-dir|--bind|--port)
      if (($# < 2)) || [[ -z $2 || $2 == --* ]]; then die "Falta el valor de $1."; fi
      case "$1" in
        --dir) project_dir=$2 ;;
        --install-dir) install_dir=$2 ;;
        --data-dir) data_dir=$2; settings_supplied=true ;;
        --bind) bind=$2; settings_supplied=true ;;
        --port) port=$2; settings_supplied=true ;;
      esac
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "Opción desconocida: $1. Consultá --help." ;;
  esac
done
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die 'La instalación como servicio requiere Linux x64 con systemd.'
((EUID != 0)) || die 'Ejecutalo con tu usuario habitual, sin sudo delante del script.'
for tool in systemctl systemd-analyze journalctl node pnpm tar sha256sum realpath flock curl; do
  command -v "$tool" >/dev/null || die "Falta $tool. Consultá docs/INSTALLING.md."
done
if [[ ! $port =~ ^[1-9][0-9]{0,4}$ ]] || ((port < 1024 || port > 65535)); then die 'El puerto debe estar entre 1024 y 65535.'; fi
[[ $bind =~ ^[a-zA-Z0-9.:_-]+$ ]] || die 'Dirección de escucha inválida.'
if [[ -z $project_dir ]]; then
  project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fi
project_dir=$(realpath -e -- "$project_dir")
[[ -f $project_dir/scripts/update-game.sh ]] || die 'No se encontró scripts/update-game.sh en el proyecto.'
[[ ! -L $install_dir && ! -L $data_dir ]] || die 'Instalación y datos deben ser carpetas, no enlaces simbólicos.'
install_dir=$(realpath -m -- "$install_dir")
data_dir=$(realpath -m -- "$data_dir")
backup_root=${install_dir}-backups
[[ ! -L $backup_root ]] || die 'La carpeta de respaldos no puede ser un enlace simbólico.'
[[ $install_dir != / && $install_dir != "$HOME" && $install_dir != "$project_dir" && $install_dir != "$project_dir"/* && $project_dir != "$install_dir"/* ]] || die 'La instalación debe estar separada del código fuente y no puede ser una carpeta amplia.'

service=ted.service
run_user=$(id -un)
if $personal; then
  ctl=(systemctl --user)
  admin=()
  unit_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  journal=(journalctl --user)
  systemctl --user show-environment >/dev/null || die 'No hay un gestor systemd de usuario disponible.'
else
  command -v sudo >/dev/null || die 'Falta sudo. Alternativa: --user-service.'
  ctl=(sudo systemctl)
  admin=(sudo)
  journal=(sudo journalctl)
  unit_dir=/etc/systemd/system
  systemctl show-environment >/dev/null || die 'El sistema no tiene systemd activo.'
fi
unit_file=$unit_dir/$service
# Do not invoke sudo for read-only system-unit inspection.
inspect=(systemctl)
$personal && inspect+=(--user)
other_scope=(systemctl --user)
$personal && other_scope=(systemctl)
other_state=$("${other_scope[@]}" show "$service" -p LoadState --value 2>/dev/null) || other_state=not-found
if [[ $other_state != not-found && $other_state != masked ]] || "${other_scope[@]}" is-active --quiet "$service" 2>/dev/null; then
  die 'Ya existe ted.service en el otro ámbito de systemd. No se creará una segunda unidad; revisá sus datos primero.'
fi
load_state=$("${inspect[@]}" show "$service" -p LoadState --value)
unit_exists=false
was_active=false
if [[ $load_state == loaded && ! -x $install_dir/ted ]] && ! "${inspect[@]}" is-active --quiet "$service"; then
  # A unit whose application is gone cannot be updated; offer to replace it.
  # Drop-ins (systemctl edit) live in ted.service.d and are kept.
  fragment=$("${inspect[@]}" show "$service" -p FragmentPath --value)
  say "ted.service existe, pero falta la aplicación en $install_dir."
  [[ -t 0 ]] || die "Borrá la unidad rota ($fragment) o ejecutá el instalador en una terminal para repararla."
  read -r -p 'Borrar esa unidad y hacer una instalación nueva? Las partidas no se tocan. [s/N] ' answer
  [[ $answer == [sS] ]] || die 'Instalación cancelada.'
  [[ -n $fragment && -f $fragment ]] || die 'No se encontró el archivo de la unidad.'
  "${ctl[@]}" disable "$service" >/dev/null 2>&1 || true
  "${admin[@]}" rm -f -- "$fragment"
  "${ctl[@]}" daemon-reload
  "${ctl[@]}" reset-failed "$service" >/dev/null 2>&1 || true
  load_state=$("${inspect[@]}" show "$service" -p LoadState --value)
fi
if [[ $load_state != not-found ]]; then
  [[ $load_state == loaded ]] || die 'La unidad existente está enmascarada o no se puede cargar.'
  unit_exists=true
  $settings_supplied && die 'El servicio ya existe. Editá su configuración aparte; se conservará durante la instalación.'
  [[ $("${inspect[@]}" show "$service" -p WorkingDirectory --value) == "$install_dir" ]] || die 'WorkingDirectory del servicio no coincide. Indicá su carpeta con --install-dir.'
  if ! $personal; then
    [[ $("${inspect[@]}" show "$service" -p User --value) == "$run_user" ]] || die 'El servicio existente debe usar tu usuario.'
  fi
  exec_start=$("${inspect[@]}" show "$service" -p ExecStart --value)
  [[ $exec_start == *"path=$install_dir/ted ;"* ]] || die 'ExecStart existente no corresponde al launcher de esta instalación.'
  [[ -x $install_dir/ted ]] || die 'La unidad existente no tiene su aplicación instalada.'
  if ! "${inspect[@]}" is-active --quiet "$service"; then
    # Its real data folder and address are read from the running process.
    say 'El servicio está detenido; se inicia un momento para leer su configuración.'
    "${ctl[@]}" start "$service" || die "No se pudo iniciar el servicio existente. Revisá: ${journal[*]} -u $service -n 50 --no-pager"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [[ $("${inspect[@]}" show "$service" -p MainPID --value) =~ ^[1-9] ]] && break
      sleep 1
    done
  fi
  if "${inspect[@]}" is-active --quiet "$service"; then
    was_active=true
    pid=$("${inspect[@]}" show "$service" -p MainPID --value)
    [[ $pid =~ ^[1-9][0-9]*$ && -r /proc/$pid/cmdline ]] || die 'No se pudo inspeccionar el proceso activo.'
    mapfile -d '' -t arguments <"/proc/$pid/cmdline"
    service_home=$HOME
    service_xdg=
    bind=0.0.0.0
    port=3000
    while IFS= read -r -d '' setting; do
      case "$setting" in
        HOME=*) service_home=${setting#HOME=} ;;
        XDG_DATA_HOME=*) service_xdg=${setting#XDG_DATA_HOME=} ;;
        GAME_HOST=*) bind=${setting#GAME_HOST=} ;;
        GAME_PORT=*) port=${setting#GAME_PORT=} ;;
      esac
    done <"/proc/$pid/environ"
    data_dir=${service_xdg:-$service_home/.local/share}/ted
    for ((i=0; i<${#arguments[@]}; i++)); do
      case "${arguments[i]}" in
        --data-dir) data_dir=${arguments[i+1]:-} ;;
        --bind) bind=${arguments[i+1]:-} ;;
        --port) port=${arguments[i+1]:-} ;;
      esac
    done
    [[ $data_dir == /* ]] || data_dir=$install_dir/$data_dir
    data_dir=$(realpath -e -- "$data_dir")
  else
    die "El servicio existente no queda activo. Revisá: ${journal[*]} -u $service -n 50 --no-pager"
  fi
fi
if [[ ! $port =~ ^[1-9][0-9]{0,4}$ ]] || ((port > 65535)); then die 'Puerto del servicio inválido.'; fi
for path in "$install_dir" "$data_dir" "$backup_root" "$project_dir"; do
  [[ $path != *$'\n'* && $path != *$'\r'* ]] || die 'Las rutas no pueden contener saltos de línea.'
done
[[ $data_dir != / && $data_dir != "$HOME" && $data_dir != "$install_dir" && $data_dir != "$install_dir"/* && $install_dir != "$data_dir"/* && $data_dir != "$backup_root" && $data_dir != "$backup_root"/* && $backup_root != "$data_dir"/* && $data_dir != "$project_dir" && $data_dir != "$project_dir"/* && $project_dir != "$data_dir"/* ]] || die 'Datos, instalación, respaldos y código deben estar separados.'
[[ $backup_root != "$project_dir" && $backup_root != "$project_dir"/* && $project_dir != "$backup_root"/* ]] || die 'Los respaldos deben estar separados del código fuente.'
[[ ! -e $install_dir || -d $install_dir ]] || die 'La ruta de instalación no es una carpeta.'
[[ ! -e $data_dir || -d $data_dir ]] || die 'La ruta de datos no es una carpeta.'
if ! $unit_exists && [[ -e $unit_file ]]; then die 'Ya hay un archivo de unidad sin cargar. Revisalo antes de instalar.'; fi
mkdir -p -- "$(dirname "$install_dir")" "$(dirname "$data_dir")" "$backup_root"
[[ -w $(dirname "$install_dir") && -w $backup_root ]] || die 'No hay permisos de escritura sobre la instalación o sus respaldos.'
[[ -w $(dirname "$data_dir") && ( ! -d $data_dir || -w $data_dir ) ]] || die 'Tu usuario necesita escritura sobre los datos y su carpeta padre para permitir recuperación.'
exec 9>"$backup_root/.install.lock"
flock -n 9 || die 'Ya hay una instalación en curso.'
[[ ! -e $install_dir || $(stat -c %d "$install_dir") == "$(stat -c %d "$backup_root")" ]] || die 'Instalación y respaldos deben compartir filesystem.'
if ! $unit_exists; then
  node -e '
    const s=require("node:net").createServer();
    s.on("error",e=>{console.error("No se puede escuchar en la dirección/puerto elegidos: "+e.message);process.exit(1)});
    s.listen(Number(process.argv[1]),process.argv[2],()=>s.close());
  ' "$port" "$bind" || die 'Elegí un puerto libre y una dirección de red válida antes de instalar.'
fi

stage=$(mktemp -d "$(dirname "$install_dir")/.ted-install.XXXXXXXX")
backup=
changing=false
new_unit=false
data_touched=false
data_existed=false
[[ ! -d $data_dir ]] || data_existed=true
snapshot_ready=false
had_app=false
app_changed=false
[[ ! -d $install_dir ]] || had_app=true
url_host=$bind
[[ $bind != 0.0.0.0 ]] || url_host=127.0.0.1
[[ $bind != :: ]] || url_host=::1
[[ $url_host != *:* ]] || url_host=[$url_host]
health_url=http://$url_host:$port/health

healthy() {
  local attempt first_pid
  for ((attempt=0; attempt<30; attempt++)); do
    if "${ctl[@]}" is-active --quiet "$service" &&
      curl -fsS --connect-timeout 2 --max-time 3 "$health_url" |
      node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).status==="ok"?0:1)}catch{process.exit(1)}})'; then
      first_pid=$("${inspect[@]}" show "$service" -p MainPID --value)
      sleep 1
      if [[ $first_pid =~ ^[1-9][0-9]*$ ]] &&
        "${ctl[@]}" is-active --quiet "$service" &&
        [[ $("${inspect[@]}" show "$service" -p MainPID --value) == "$first_pid" ]]; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

finish() {
  local result=$?
  trap - EXIT INT TERM
  if $changing; then
    say 'Instalación fallida. Recuperando el estado anterior…' >&2
    if { $unit_exists || $new_unit; } && ! "${ctl[@]}" stop "$service"; then
      if [[ $("${inspect[@]}" show "$service" -p LoadState --value) != not-found ]]; then
        say "No se pudo detener el servicio. Revisá el respaldo: $backup" >&2
        exit 1
      fi
    fi
    if [[ -e $backup/app ]]; then
      [[ ! -e $install_dir ]] || mv -T -- "$install_dir" "$backup/failed-app"
      mv -T -- "$backup/app" "$install_dir"
    elif ! $had_app && $app_changed && [[ -e $install_dir ]]; then
      mv -T -- "$install_dir" "$backup/failed-app"
    fi
    if $data_touched && [[ -e $data_dir ]]; then
      local recovered=
      if $data_existed && $snapshot_ready; then
        recovered=$(mktemp -d "$(dirname "$data_dir")/.ted-recover.XXXXXXXX")
        cp -a -- "$backup/data/." "$recovered/" || { say "No se pudo recuperar la copia de datos: $backup/data" >&2; exit 1; }
      fi
      mv -T -- "$data_dir" "$data_dir.failed-${backup##*/}"
      [[ -z $recovered ]] || mv -T -- "$recovered" "$data_dir"
    fi
    if $new_unit; then
      "${ctl[@]}" disable "$service" || true
      "${admin[@]}" rm -f -- "$unit_file"
      "${ctl[@]}" daemon-reload
    elif $was_active; then
      if "${ctl[@]}" start "$service" && healthy; then
        say 'La versión anterior vuelve a responder.' >&2
      else
        say "No se pudo recuperar el servicio automáticamente. Respaldo: $backup" >&2
      fi
    fi
    result=1
  fi
  rm -rf -- "$stage"
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bash "$project_dir/scripts/update-game.sh" "$mode" --dir "$project_dir"
metadata=$(node -e '
  const m=require(process.argv[1]);
  if(m.platform!=="linux" || m.architecture!=="x64" || !/^ted-[0-9A-Za-z.+_-]+-linux-x64\.tar\.gz$/.test(m.artifact) || !/^[a-f0-9]{64}$/.test(m.sha256))process.exit(1);
  console.log(m.artifact+" "+m.sha256);
' "$project_dir/release/manifest-linux-x64.json") || die 'Manifest Linux inválido.'
read -r artifact expected <<<"$metadata"
actual=$(sha256sum "$project_dir/release/$artifact")
[[ ${actual%% *} == "$expected" ]] || die 'Checksum del paquete inválido.'
directory=${artifact%.tar.gz}
tar -tzf "$project_dir/release/$artifact" >"$stage/members"
while IFS= read -r member; do
  [[ $member == "$directory/"* && $member != *'/../'* && $member != */.. && $member != *'/./'* && $member != *'//'* ]] || die 'Ruta insegura en el paquete.'
done <"$stage/members"
tar -tvzf "$project_dir/release/$artifact" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}' || die 'El paquete contiene enlaces o archivos especiales.'
tar -xzf "$project_dir/release/$artifact" -C "$stage" --no-same-owner --no-same-permissions
candidate=$stage/$directory
[[ -x $candidate/ted && -x $candidate/runtime/node && -f $candidate/web/index.html ]] || die 'El paquete está incompleto.'
"$candidate/ted" --version

unit_quote() {
  local value=$1
  value=${value//\\/\\\\}; value=${value//\"/\\\"}; value=${value//%/%%}; value=${value//\$/\$\$}
  printf '"%s"' "$value"
}
if ! $unit_exists; then
  {
    printf '[Unit]\nDescription=Terra en disputa Game Server\nAfter=network.target\n\n[Service]\nType=simple\n'
    $personal || printf 'User=%s\n' "$run_user"
    printf 'WorkingDirectory=%s\n' "${install_dir//%/%%}"
    printf 'ExecStart=%s --no-open --bind %s --port %s --data-dir %s\n' "$(unit_quote "$install_dir/ted")" "$(unit_quote "$bind")" "$port" "$(unit_quote "$data_dir")"
    printf 'Restart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=%s\n' "$($personal && printf default.target || printf multi-user.target)"
  } >"$stage/ted.service"
fi
if ! $personal; then sudo -v; fi
backup=$(mktemp -d "$backup_root/$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
changing=true
if $unit_exists; then "${ctl[@]}" stop "$service"; fi
data_existed=false
[[ ! -d $data_dir ]] || data_existed=true
if $data_existed; then
  cp -a -- "$data_dir" "$backup/data"
  snapshot_ready=true
  if [[ -x $install_dir/ted ]]; then
    "$install_dir/ted" backup --data-dir "$data_dir" --output "$backup/games.json"
  fi
  cp -a -- "$backup/data" "$stage/compatibility-data"
  "$candidate/ted" backup --data-dir "$stage/compatibility-data" --output "$stage/compatibility.json"
fi
if [[ -e $install_dir ]]; then mv -T -- "$install_dir" "$backup/app"; fi
app_changed=true
mv -T -- "$candidate" "$install_dir"
if ! $unit_exists; then
  systemd-analyze verify "$stage/ted.service"
  new_unit=true
  "${admin[@]}" install -d -m 755 -- "$unit_dir"
  "${admin[@]}" install -m 644 -- "$stage/ted.service" "$unit_file"
  "${ctl[@]}" daemon-reload
fi
mkdir -p -- "$(dirname "$data_dir")"
data_touched=true
"${ctl[@]}" start "$service"
healthy || die 'El servicio no respondió correctamente.'
invocation=$("${inspect[@]}" show "$service" -p InvocationID --value)
[[ $invocation =~ ^[a-f0-9]{32}$ ]] || die 'No se pudo identificar el arranque del servicio.'
"${journal[@]}" "_SYSTEMD_INVOCATION_ID=$invocation" --no-pager -o cat >"$stage/startup.log"
if grep -Fq 'Persisted game is unavailable' "$stage/startup.log"; then die 'No se pudieron cargar todas las partidas.'; fi
"${ctl[@]}" enable "$service"
changing=false
say "Instalación completada: $install_dir"
say "Datos persistentes: $data_dir"
say "Respaldo: $backup"
say "Administración: http://$url_host:$port/admin"
if $personal; then
  say 'Estado: systemctl --user status ted.service'
  say 'Código administrativo: journalctl --user -u ted.service -n 100 --no-pager'
  say 'Para funcionar sin una sesión abierta: sudo loginctl enable-linger '"$run_user"
else
  say 'Estado: sudo systemctl status ted.service'
  say 'Código administrativo: sudo journalctl -u ted.service -n 100 --no-pager'
fi
