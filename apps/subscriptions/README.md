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
- Copia de seguridad en JSON (exportar e importar), modo oscuro automático e instalable
  en el móvil.

La app se actualiza sola: comprueba la fecha cada 20 segundos y cuando vuelves a la
pestaña. Al cambiar el día, recalcula lo cobrado y lo pendiente, las próximas renovaciones
y los recordatorios.

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
