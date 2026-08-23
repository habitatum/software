import { Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatoPesos } from './calculosOC';
import { COLOR_DORADO } from './EncabezadoPDF';

const estilos = StyleSheet.create({
  seccion: { marginBottom: 12 },
  tituloSeccion: { fontSize: 11, fontWeight: 'bold', marginBottom: 4, borderBottom: 1, borderColor: COLOR_DORADO, paddingBottom: 2 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
});

// Cuadro "Acumulados del contrato": excluye filas ANTICIPO del Subtotal/Total (ver
// references/mapa_columnas.md del skill ordenes-de-compra-obra), igual que en el
// sistema Apps Script. Compartido entre el PDF de Orden de Compra y el PDF de Contrato.
export default function CuadroAcumuladosPDF({ acumulados, numeroContrato, anticipoPendienteContrato = 0 }) {
  if (!acumulados) return null;
  return (
    <View style={estilos.seccion}>
      <Text style={estilos.tituloSeccion}>
        Acumulados del contrato{numeroContrato ? ` (${numeroContrato})` : ''}
      </Text>
      <View style={estilos.fila}><Text>Subtotal acumulado (excluye anticipos)</Text><Text>{formatoPesos(acumulados.subtotal_acumulado)}</Text></View>
      <View style={estilos.fila}><Text>Total acumulado (excluye anticipos)</Text><Text>{formatoPesos(acumulados.total_acumulado)}</Text></View>
      <View style={estilos.fila}><Text>Retenido acumulado</Text><Text>{formatoPesos(acumulados.retenido_acumulado)}</Text></View>
      <View style={estilos.fila}><Text>Amortizado acumulado</Text><Text>{formatoPesos(acumulados.amortizado_acumulado)}</Text></View>
      <View style={estilos.fila}><Text>Anticipo pendiente por amortizar</Text><Text>{formatoPesos(anticipoPendienteContrato)}</Text></View>
      <View style={estilos.fila}><Text>Devolución acumulada</Text><Text>{formatoPesos(acumulados.devolucion_acumulada)}</Text></View>
    </View>
  );
}
