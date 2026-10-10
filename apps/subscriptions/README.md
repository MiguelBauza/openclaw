# Mis Suscripciones

App web (PWA) para gestionar suscripciones mensuales y controlar el gasto. No necesita
compilación ni dependencias: HTML + CSS + JavaScript.

## Funciones

- **Ficha de cada suscripción**: nombre, qué es (descripción), categoría, precio,
  periodicidad (semanal, mensual, trimestral, semestral, anual), fecha de cobro, método de
  pago, web para gestionar o cancelar, color, fecha de baja y estado activa o pausada.
- **Fechas fijas de renovación**: el día de cobro se mantiene cada periodo. Si es el 29, 30
  o 31, en los meses más cortos pasa al último día del mes.
- **Resumen del mes en curso, en tiempo real**:
  - lo **ya cobrado** (cobros con fecha de hoy o anterior),
  - lo **pendiente** de cobrar este mes,
  - el total del mes, el gasto anual estimado y la media mensual,
  - el reparto del gasto por categoría.
- **Calendario mensual** con los días de cobro de cada plataforma o app (puedes moverte
  entre meses).
- **Recordatorios**: un aviso dentro de la app y una notificación del navegador X días
  antes de cada renovación (configurable por suscripción).
- **Exportar a calendario (.ics)**: crea eventos recurrentes con alarma en Google Calendar,
  Apple Calendar u Outlook, para recibir avisos aunque la app esté cerrada.
- Copia de seguridad en JSON (exportar e importar) y modo oscuro automático.
- Diseño de estilo iOS: título grande, listas agrupadas, tarjeta principal con degradado y
  anillo de progreso, barra de pestañas translúcida abajo en el móvil (arriba en pantallas
  anchas) y formulario en hoja inferior.

La app se actualiza sola: comprueba la fecha cada 20 segundos y cuando vuelves a la
pestaña. Al cambiar el día, recalcula lo cobrado y lo pendiente, las próximas renovaciones
y los recordatorios.

## Instalar en el móvil (PWA)

La app es una PWA: se instala en la pantalla de inicio, se abre a pantalla completa y
funciona sin conexión gracias al service worker (`sw.js`). Incluye iconos para iOS y
Android (`icons/`), accesos directos («Añadir suscripción» y «Calendario de cobros») y una
tarjeta en **Ajustes** con el botón Instalar (Android/Chrome) o los pasos para Safari (iOS).

Para instalarla necesita servirse por HTTPS. El workflow
`.github/workflows/subscriptions-pages.yml` la publica en GitHub Pages al hacer push a
`main` (o a mano desde Actions):

1. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
2. Haz merge a `main` (o lanza el workflow «Subscriptions app (GitHub Pages)»).
3. Abre la URL de Pages en el móvil:
   - iPhone (Safari): **Compartir → Añadir a pantalla de inicio**.
   - Android (Chrome): **Ajustes → Instalar** dentro de la app, o el menú ⋮ → Instalar app.

## Versión publicada en Claude

`store.js` detecta si la página se abre dentro del visor de artefactos de Claude y, en ese
caso, sincroniza los datos con la cuenta (capacidad `db`) y oculta lo que el visor no
permite (notificaciones, .ics e instalación). Para regenerar el HTML de una sola pieza:

```bash
node apps/subscriptions/scripts/build-artifact.mjs suscripciones-artifact.html
```

## Uso

Abre `index.html` directamente en el navegador, o sírvela para poder instalarla como app
y activar el modo sin conexión:

```bash
cd apps/subscriptions
python3 -m http.server 8080
# abre http://localhost:8080
```

Los datos se guardan solo en el `localStorage` del navegador. Haz copias con
**Ajustes → Exportar JSON**.

## Tests

```bash
node --test apps/subscriptions/schedule.test.mjs
```
