/**
 * Compresión de fotos antes de enviarlas.
 *
 * Las fotos (evidencia de merma, factura de un gasto, soporte de un cierre) se
 * guardan como texto dentro de la base de datos. Una foto de celular sin tocar
 * pesa entre 3 y 10 MB; guardada así, unas pocas al día hinchan la base y hacen
 * lento cada guardado.
 *
 * Antes se reducían a 1200 px con calidad 0,7 y quedaban en ~103 KB cada una.
 * Para una foto que solo tiene que dejar ver qué se dañó, eso es más resolución
 * de la necesaria: a 900 px y calidad 0,55 se sigue distinguiendo perfectamente
 * y pesa alrededor de un tercio.
 *
 * El texto va en base64, que abulta un 33% más que el archivo original: por eso
 * el tope del servidor se mide sobre el texto ya codificado, no sobre el JPEG.
 */

/** Lado mayor de la imagen guardada, en píxeles. */
const LADO_MAXIMO = 900;

/** Calidad JPEG (0 a 1). */
const CALIDAD = 0.55;

/** Tamaño máximo del archivo que se acepta del usuario, antes de comprimir. */
const MAXIMO_ORIGINAL_MB = 20;

/**
 * Lee una imagen, la reduce y devuelve el texto base64 listo para enviar.
 *
 * Si algo falla al comprimir (un formato raro, un canvas no disponible) se
 * devuelve la imagen original: es preferible guardar una foto pesada a perder
 * la evidencia.
 */
export function comprimirImagen(file: File, callback: (base64: string) => void): void {
  if (!file) return;

  if (file.size > MAXIMO_ORIGINAL_MB * 1024 * 1024) {
    alert(`La imagen es demasiado grande. Elija una de menos de ${MAXIMO_ORIGINAL_MB} MB.`);
    return;
  }

  const reader = new FileReader();

  reader.onload = (event) => {
    const original = event.target?.result as string;
    const img = new Image();

    img.onload = () => {
      try {
        let { width, height } = img;
        const lado = Math.max(width, height);
        if (lado > LADO_MAXIMO) {
          const factor = LADO_MAXIMO / lado;
          width = Math.round(width * factor);
          height = Math.round(height * factor);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return callback(original);

        ctx.drawImage(img, 0, 0, width, height);
        const comprimida = canvas.toDataURL("image/jpeg", CALIDAD);

        // Si comprimir dejó la imagen más pesada (pasa con capturas muy planas
        // que ya venían en PNG optimizado), se conserva la más liviana.
        callback(comprimida.length < original.length ? comprimida : original);
      } catch (err) {
        console.error("No se pudo comprimir la imagen; se envía la original:", err);
        callback(original);
      }
    };

    img.onerror = () => callback(original);
    img.src = original;
  };

  reader.onerror = () => alert("No se pudo leer la imagen seleccionada.");
  reader.readAsDataURL(file);
}

/** Peso aproximado en KB de una foto ya codificada, para mostrarlo o validarlo. */
export function pesoEnKb(base64: string): number {
  return Math.round((base64?.length || 0) / 1024);
}
