// Descarga o comparte un archivo (ej. PDF) generado por el servidor.
//
// Problema que resuelve: en iPhone/iPad, cuando la app está agregada a la
// pantalla de inicio (PWA instalada), un <a target="_blank"> a un PDF no abre
// Safari: lo renderiza dentro del mismo webview de la app, sin ninguna barra
// con opciones de compartir o descargar (se ve "como un pantallazo"). La
// solución es traer el archivo con fetch y entregarlo con la Web Share API,
// que sí muestra la hoja nativa de compartir/guardar aunque la app esté
// instalada. En navegadores de escritorio (sin Web Share de archivos) se
// hace en su lugar una descarga directa del blob.
export async function compartirOAbrirArchivo(url, nombreArchivo, opciones = {}) {
  const { tipo = 'application/pdf' } = opciones;
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error('No se pudo generar el archivo.');
    const blob = await respuesta.blob();
    const archivo = new File([blob], nombreArchivo, { type: tipo });

    // Solo en celular/tablet usamos la hoja nativa de compartir: es la única
    // forma de guardar el PDF cuando la app está instalada en la pantalla de
    // inicio de iPhone/iPad. Windows/Mac con Chrome o Edge también implementan
    // navigator.share con archivos, pero ahí el usuario espera una descarga
    // directa a la carpeta de Descargas, no la hoja de compartir — por eso se
    // restringe esta rama a dispositivos móviles.
    const esMovil = typeof navigator !== 'undefined' && (
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );

    if (esMovil && navigator.canShare && navigator.canShare({ files: [archivo] })) {
      await navigator.share({ files: [archivo] });
      return;
    }

    // Escritorio (y celulares sin soporte de Web Share con archivos): descarga directa del blob.
    const urlObjeto = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = urlObjeto;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(urlObjeto), 10000);
  } catch (err) {
    if (err && err.name === 'AbortError') return; // el usuario canceló la hoja de compartir
    // Último recurso: el comportamiento anterior (abrir en pestaña nueva).
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
