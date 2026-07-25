import fs from 'fs';
import path from 'path';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';

// Colores reales de marca HABITATUM.
const COLOR_FONDO = '#2e2e2e'; // carbón
const COLOR_DORADO = '#b88a52'; // dorado

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
  pagina: { padding: 30, fontSize: 10, fontFamily: 'Helvetica' },
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
  folio: { fontSize: 12, color: COLOR_DORADO, marginTop: 4 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  seccion: { marginBottom: 12 },
  tituloSeccion: { fontSize: 11, fontWeight: 'bold', marginBottom: 4, borderBottom: 1, borderColor: COLOR_DORADO, paddingBottom: 2 },
  tablaEncabezado: { flexDirection: 'row', backgroundColor: '#efece6', padding: 4, fontWeight: 'bold' },
  tablaFila: { flexDirection: 'row', padding: 4, borderBottom: 0.5, borderColor: '#cdc5ba' },
  colDesc: { flex: 4 }, colCant: { flex: 1, textAlign: 'right' }, colVal: { flex: 2, textAlign: 'right' },
  totalDestacado: { fontSize: 13, fontWeight: 'bold', marginTop: 8, color: COLOR_DORADO },
});

export default function PlantillaOrdenCompraPDF({ oc, items, calculo, nombreObra }) {
  return (
    <Document>
      <Page size="A4" style={estilos.pagina}>
        <View style={estilos.encabezado}>
          {logoDataUri && <Image src={logoDataUri} style={estilos.logo} />}
          <View>
            <Text style={estilos.empresa}>HABITATUM</Text>
            <Text style={estilos.folio}>Orden de Compra {oc.folio}</Text>
            {nombreObra && <Text>{nombreObra}</Text>}
          </View>
        </View>

        <View style={estilos.seccion}>
          <View style={estilos.fila}><Text>Proveedor:</Text><Text>{oc.proveedores?.nombre}</Text></View>
          <View style={estilos.fila}><Text>NIT:</Text><Text>{oc.proveedores?.nit}</Text></View>
          <View style={estilos.fila}><Text>Fecha:</Text><Text>{oc.fecha}</Text></View>
          <View style={estilos.fila}><Text>Descripción:</Text><Text>{oc.descripcion}</Text></View>
        </View>

        <View style={estilos.seccion}>
          <Text style={estilos.tituloSeccion}>Ítems</Text>
          <View style={estilos.tablaEncabezado}>
            <Text style={estilos.colDesc}>Descripción</Text>
            <Text style={estilos.colCant}>Cant.</Text>
            <Text style={estilos.colVal}>Valor</Text>
          </View>
          {items.map((it, i) => (
            <View key={i} style={estilos.tablaFila}>
              <Text style={estilos.colDesc}>{it.descripcion}</Text>
              <Text style={estilos.colCant}>{it.cantidad}</Text>
              <Text style={estilos.colVal}>{formatoPesos(it.cantidad * it.valor_unitario)}</Text>
            </View>
          ))}
        </View>

        <View style={estilos.seccion}>
          <View style={estilos.fila}><Text>Subtotal</Text><Text>{formatoPesos(calculo.subtotal)}</Text></View>
          {oc.tipo_impuesto === 'CON_AIU' && (
            <View style={estilos.fila}><Text>Valor AIU</Text><Text>{formatoPesos(calculo.valor_aiu)}</Text></View>
          )}
          <View style={estilos.fila}><Text>Valor IVA</Text><Text>{formatoPesos(calculo.valor_iva)}</Text></View>
          <View style={estilos.fila}><Text>Retención</Text><Text>{formatoPesos(calculo.valor_retenido)}</Text></View>
          <View style={estilos.fila}><Text style={estilos.totalDestacado}>Valor a pagar</Text><Text style={estilos.totalDestacado}>{formatoPesos(calculo.neto_a_pagar)}</Text></View>
        </View>
      </Page>
    </Document>
  );
}
