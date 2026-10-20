# Self-hosted product font

`inter-latin-wght-normal.woff2` is the unchanged normal, weight-variable Latin
subset from **@fontsource-variable/inter@5.3.0**. It supports weights 100–900.
The Latin range includes Danish ÆØÅ/æøå. PodView serves this single 48,256-byte
file from its own origin; there are no runtime font-service requests or
JavaScript font dependencies.

- Package: https://www.npmjs.com/package/@fontsource-variable/inter/v/5.3.0
- Pinned archive: https://registry.npmjs.org/@fontsource-variable/inter/-/inter-5.3.0.tgz
- Fontsource documentation: https://fontsource.org/fonts/inter/use
- Original project: https://github.com/rsms/inter
- License: SIL Open Font License 1.1, copied verbatim to `OFL-Inter.txt`.
- Archive integrity: `sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==`
- Font SHA-256: `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`

Retrieved 20 October 2026 with `npm pack --ignore-scripts`; the font and license
were copied directly from the package. The font-face declaration uses the
package's Latin unicode range and the shared `--pv-screen-font` token. The
weight-only file keeps this one required request smaller than the optical-size
variant. Native fallback fonts remain available while the local file loads.
