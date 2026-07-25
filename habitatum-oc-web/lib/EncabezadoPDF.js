import fs from 'fs';
import path from 'path';
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer';

// Colores reales de marca HABITATUM.
export const COLOR_FONDO = '#2e2e2e'; // carbón
export const COLOR_DORADO = '#b88a52'; // dorado

// El logo se lee del disco una sola vez y se convierte a data URI, para que
// funcione dentro del PDF sin depender de una URL externa.
let logoDataUri = null;
try {
  const logoPath = path.join(process.cwd(), 'public', 'logo-habitatum-pdf.png');
  const logoBuffer = fs.readFileSync(logoPath);
  logoDataUri = `data:image/png;base64,${logoBuffer.toString('base64')}`;
} catch (e) {
  logoDataUri = null; // si no se encuentra el archivo, el PDF se genera igual, sin logo
}

const estilos = StyleSheet.create({
  encabezado: {
    backgroundColor: COLOR_FONDO,
    color: 'white',
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: { width: 28, height: 44, marginRight: 14 },
  empresa: { fontSize: 16, fontWeight: 'bold' },
  tituloDoc: { fontSize: 12, color: COLOR_DORADO, marginTop: 4 },
});

/**
 * Encabezado compartido entre los PDF de Órdenes de Compra y Contratos.
 * Si el proyecto NO debe mostrar la marca HABITATUM (mostrarMarcaHabitatum === false),
 * se oculta el logo y se reemplaza el nombre por el que el Admin haya definido
 * para ese proyecto (nombreEmisor), por ejemplo "Arq. Andrés David Hincapié".
 */
export function EncabezadoPDF({ tituloDocumento, nombreObra, mostrarMarcaHabitatum = true, nombreEmisor }) {
  const mostrarHabitatum = mostrarMarcaHabitatum !== false;
  return (
    <View style={estilos.encabezado}>
      {mostrarHabitatum && logoDataUri && <Image src={logoDataUri} style={estilos.logo} />}
      <View>
        <Text style={estilos.empresa}>{mostrarHabitatum ? 'HABITATUM' : (nombreEmisor || '')}</Text>
        <Text style={estilos.tituloDoc}>{tituloDocumento}</Text>
        {nombreObra && <Text>{nombreObra}</Text>}
      </View>
    </View>
  );
}
