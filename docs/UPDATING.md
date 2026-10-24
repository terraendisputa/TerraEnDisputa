# Actualizar y compilar Terra en disputa

El nombre corto es **TED**. Los paquetes se llaman `ted-<versión>-<plataforma>` y se ejecutan mediante `ted` en Linux o `ted.cmd` en Windows. `TED_BUILD_MEMORY_MB` configura el límite de memoria de compilación.

`scripts/update-game.sh` prepara un paquete portable desde el código fuente. Funciona desde cualquier ubicación y no depende del usuario o la configuración de un VPS.

## Requisitos

- Bash.
- Node.js **>=24.11.0 y <25**, instalado desde una distribución nativa completa con su licencia.
- pnpm **10.15.0**.
- Git para `--pull`.
- Internet para descargar dependencias y, con `--pull`, el código.

El empaquetado existente admite Linux x64 y Windows x64. En Windows hace falta Bash, por ejemplo Git Bash, y Node para Windows; el script no convierte una compilación Linux de WSL en un paquete Windows. El script se probó en Linux; con Git Bash no se probó. macOS y ARM no tienen paquetes soportados actualmente.

Con Node 24 instalado, se puede preparar pnpm mediante:

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
```

## Compilar la copia local

Dentro del proyecto:

```bash
bash scripts/update-game.sh --build
```

Sin opciones también compila. Admite código descargado como ZIP y cambios locales; no requiere Git. Instalar dependencias sigue necesitando acceso al registro de paquetes si no están disponibles localmente.

Si copiaste el script fuera del proyecto, indicá la carpeta fuente:

```bash
bash /ruta/update-game.sh --build --dir /ruta/al/codigo/ted
```

## Traer el código nuevo

En un clon de Git, `bash scripts/update-game.sh --pull` trae `main` desde el repositorio público y después compila. Usa la URL HTTPS de `package.json`, sin pedir ni guardar credenciales. Exige estar en `main` sin cambios locales y solo avanza en línea recta (`--ff-only`); no cambia de rama ni descarta archivos.

Si descargaste el código como ZIP, bajá el ZIP nuevo, reemplazá la carpeta y compilá con `--build`.

## Compilación y resultado

Ambos modos:

1. Instalan dependencias usando el lockfile (`pnpm install --frozen-lockfile`).
2. Compilan los paquetes secuencialmente.
3. Ejecutan `scripts/release-build.mjs` para generar el paquete de la plataforma actual.
4. Ejecutan `scripts/release-smoke.mjs` para verificar el archivo, checksum, arranque, reinicio y backup en datos descartables.

El resultado queda en `release/`, junto con `SHA256SUMS` y el manifest. El script de empaquetado regenera esa carpeta; guardá fuera de ella los paquetes anteriores que quieras conservar. No ejecutes el juego instalado desde esa misma carpeta mientras regenerás el paquete.

Para equipos pequeños, el heap de Node se limita a 512 MB por defecto. Es un límite del heap, no del consumo total del proceso. En equipos con 1 GB de RAM conviene tener swap. Si la compilación necesita más heap y el equipo tiene memoria suficiente:

```bash
TED_BUILD_MEMORY_MB=1024 bash scripts/update-game.sh --build
```

Si falla una etapa, termina con error y no anuncia un paquete verificado. Arreglá la causa y repetí `--build`.

## Instalar el resultado

Este script termina al generar y verificar el paquete. La instalación y administración del servidor se realizan por separado: detener el servidor, respaldar partidas, extraer la nueva aplicación conservando la carpeta persistente y volver a iniciarlo. Consultá [la guía de alojamiento](SELF_HOSTING.md#copias-restauración-y-actualización).

Para compilar e instalar como servicio en Linux con systemd, usá `bash scripts/install-game.sh`. Puede actualizar una instalación compatible conservando su unidad y sus partidas. Consultá [la guía del instalador](INSTALLING.md).
