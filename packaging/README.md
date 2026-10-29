# Paquetes de Linux

La aplicación de escritorio también se publica en AUR (`terra-en-disputa-bin`) y en Flathub (`io.github.terraendisputa.TerraEnDisputa`). Los dos paquetes usan el `.tar.gz` de Linux que la CI adjunta a cada versión, así que no compilan nada.

- `linux/`: lanzador (`.desktop`), ficha de AppStream (`.metainfo.xml`) y capturas. `scripts/desktop-build.mjs` los copia dentro de la aplicación (en `resources/linux`) y agrega a la ficha la versión que se está armando.
- `aur/PKGBUILD` y `aur/.SRCINFO`: el paquete de AUR.
- `flathub/io.github.terraendisputa.TerraEnDisputa.yml`: el manifiesto de Flathub.

## Con cada versión nueva

1. Publicá la versión en GitHub (la CI adjunta los instaladores y `SHA256SUMS`).
2. Apuntá los paquetes a esa versión:

   ```bash
   node scripts/packaging-update.mjs        # usa la versión de package.json
   ```

   Actualiza versión, enlace y checksum en el `PKGBUILD`, el `.SRCINFO` y el manifiesto. Guardá el cambio en el repositorio.

3. AUR: copiá `PKGBUILD` y `.SRCINFO` al repositorio de AUR y subilos.

   ```bash
   git clone ssh://aur@aur.archlinux.org/terra-en-disputa-bin.git
   cp packaging/aur/PKGBUILD packaging/aur/.SRCINFO terra-en-disputa-bin/
   cd terra-en-disputa-bin && git add PKGBUILD .SRCINFO && git commit -m "Update to 1.1.0" && git push
   ```

4. Flathub: copiá el manifiesto al repositorio `flathub/io.github.terraendisputa.TerraEnDisputa` y abrí un PR ahí.

## La primera vez

- **AUR:** creá una cuenta en [aur.archlinux.org](https://aur.archlinux.org/register) (pide un email real para activarla, que no aparece en el paquete) y cargá tu clave SSH pública en el perfil. El primer `git push` al repositorio `terra-en-disputa-bin` crea el paquete.
- **Flathub:** seguí la [guía de envío](https://docs.flathub.org/docs/for-app-authors/submission). Hacé un fork de `flathub/flathub`, creá una rama desde `new-pr`, agregá el manifiesto en la raíz y abrí el PR contra `new-pr` con el título `Add io.github.terraendisputa.TerraEnDisputa`. Cuando lo aprueban, Flathub crea el repositorio del paquete y te da acceso. Para que figure como verificado, iniciá sesión en flathub.org con la cuenta de GitHub que administra la organización `terraendisputa`.

Las capturas de la ficha se cargan desde la rama `main`, así que solo funcionan después de fusionar `experimental` en `main`.
