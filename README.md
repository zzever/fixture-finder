# fixture-finder
Dashboard para buscar librerías de fixtures de iluminación desde planos PDF (Capture, WYSIWYG) — MA2, MA3, Avolites, GDTF
https://zzever.github.io/fixture-finder/fixture-finder.html

## Backend opcional (conversión GDTF → QLab)

`worker/index.js` es un Worker para Freebuff Sites que sirve el sitio y expone `POST /api/qlab`.
Convierte un GDTF a `.qlablight` con la clave de Gemini guardada como secreto del servidor
(`GEMINI_API_KEY`), así cada visitante no tiene que pegar la suya.

- En GitHub Pages el cliente sigue funcionando sin backend: pide la clave al visitante y la guarda en su `localStorage`.
- En Freebuff Sites, `GET /api/health` responde `{"serverKey":true}` cuando el secreto está configurado.
- Límites: 12 conversiones/hora y 40/día por IP, GDTF de hasta 80.000 caracteres, solo mismo origen.

El prompt GDTF → QLab está en `prompt.js` y es el mismo para el navegador y el Worker (que lo importa como módulo ESM declarado en `sites.deploy.json`).

Desplegar: `bash build-sites.sh` (arma `deploy-public/`, ignorado por git) y luego desplegar con el manifiesto `sites.deploy.json`.

## Empleo (ofertas del sector espectaculos y eventos)

La web incluye una vista "Empleo" con ofertas curadas para tecnico de iluminacion /
spectaculos / audiovisual en Espana (datos en `jobs.js`, compartidos por el navegador y
el Worker). El Worker expone un feed RSS 2.0 y JSON para apps externas:

- `GET /api/feed` (alias `/feed.xml`, `/rss.xml`) -> RSS 2.0 (`application/rss+xml`)
- `GET /api/jobs` (alias `/jobs.json`) -> JSON `{ ok, count, items }`

Ambos endpoints tienen CORS abierto para consumo desde apps externas.
