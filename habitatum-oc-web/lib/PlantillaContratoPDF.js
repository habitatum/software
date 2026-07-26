import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';
import { EncabezadoPDF, COLOR_DORADO } from './EncabezadoPDF';
import CuadroAcumuladosPDF from './CuadroAcumuladosPDF';

const estilos = StyleSheet.create({
  pagina: { padding: 30, fontSize: 10, fontFamily: 'Helvetica' },
  fila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  seccion: { marginBottom: 12 },
  tituloSeccion: { fontSize: 11, fontWeight: 'bold', marginBottom: 4, borderBottom: 1, borderColor: COLOR_DORADO, paddingBottom: 2 },
  tablaEncabezado: { flexDirection: 'row', backgroundColor: '#efece6', padding: 4, fontWeight: 'bold' },
  tablaFila: { flexDirection: 'row', padding: 4, borderBottom: 0.5, borderColor: '#cdc5ba' },
  colFolio: { flex: 2 }, colFecha: { flex: 2 }, colTipo: { flex: 2 }, colVal: { flex: 2, textAlign: 'right' },
  totalDestacado: { fontSize: 13, fontWeight: 'bold', marginTop: 8, color: COLOR_DORADO },
});

export default function PlantillaContratoPDF({ contrato, acumulados, ordenes, nombreObra, mostrarMarcaHabitatum, nombreEmisor }) {
  return (
    <Document>
      <Page size="A4" style={estilos.pagina}>
        <EncabezadoPDF
          tituloDocumento={`Contrato ${contrato.numero_contrato}`}
          nombreObra={nombreObra}
          mostrarMarcaHabitatum={mostrarMarcaHabitatum}
          nombreEmisor={nombreEmisor}
        />

        <View style={estilos.seccion}>
          <View style={estilos.fila}><Text>Contratista:</Text><Text>{contrato.proveedores?.nombre}</Text></View>
          <View style={estilos.fila}><Text>NIT:</Text><Text>{contrato.proveedores?.nit}</Text></View>
          <View style={estilos.fila}><Text>Concepto:</Text><Text>{contrato.concepto}</Text></View>
          <View style={estilos.fila}><Text>Valor inicial:</Text><Text>{formatoPesos(contrato.valor_inicial)}</Text></View>
        </View>

        <CuadroAcumuladosPDF acumulados={acumulados} />

        <View style={estilos.seccion}>
          <Text style={estilos.tituloSeccion}>Órdenes de Compra del contrato</Text>
          <View style={estilos.tablaEncabezado}>
            <Text style={estilos.colFolio}>Folio</Text>
            <Text style={estilos.colFecha}>Fecha</Text>
            <Text style={estilos.colTipo}>Tipo pago</Text>
            <Text style={estilos.colVal}>Total</Text>
          </View>
          {(ordenes || []).map((o) => (
            <View key={o.id} style={estilos.tablaFila}>
              <Text style={estilos.colFolio}>{o.folio}</Text>
              <Text style={estilos.colFecha}>{o.fecha}</Text>
              <Text style={estilos.colTipo}>{o.tipo_pago}</Text>
              <Text style={estilos.colVal}>{formatoPesos(o.total)}</Text>
            </View>
          ))}
          {(!ordenes || ordenes.length === 0) && (
            <Text style={{ padding: 6, color: '#737373' }}>Sin órdenes de compra registradas.</Text>
          )}
        </View>
      </Page>
    </Document>
  );
}
