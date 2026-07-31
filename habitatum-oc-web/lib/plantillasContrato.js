// Plantillas de tipo de contrato y cláusulas — portado 1:1 del texto legal ya aprobado en el
// App Script de Órdenes de Compra (función plantillaClausulas()). Si se cambia algo aquí, el
// texto deja de coincidir con el que se usó en los contratos generados por el App Script.

export const TIPOS_CONTRATO = ['SUMINISTRO_E_INSTALACION', 'MANO_DE_OBRA', 'SUMINISTROS'];

export const NOMBRES_TIPO_CONTRATO = {
  SUMINISTRO_E_INSTALACION: 'Suministro e Instalación',
  MANO_DE_OBRA: 'Mano de Obra',
  SUMINISTROS: 'Suministros',
};

export const TITULOS_TIPO_CONTRATO = {
  SUMINISTRO_E_INSTALACION: 'CONTRATO DE OBRA No. ',
  MANO_DE_OBRA: 'CONTRATO DE MANO DE OBRA No. ',
  SUMINISTROS: 'CONTRATO DE SUMINISTRO No. ',
};

const PLANTILLAS = {
  SUMINISTRO_E_INSTALACION: [
    { id: 'primera', titulo: 'PRIMERA. Objeto.', texto: 'El Contratista se obliga con el Contratante a ejecutar la obra descrita en el cuadro de información de este contrato, en el inmueble allí señalado, conforme a las especificaciones, planos e instrucciones entregadas por el Contratante.' },
    { id: 'segunda', titulo: 'SEGUNDA. Valor y forma de pago.', texto: 'El valor del presente contrato es el indicado en el cuadro de información. El pago se realizará mediante Órdenes de Compra parciales expedidas por el Contratante a medida que se ejecuten y aprueben cortes de obra, cada una con su propio soporte y detalle. Si este contrato tiene anticipo (ver cuadro de Pólizas), este se amortizará contra dichas Órdenes de Compra hasta agotarse.' },
    { id: 'tercera', titulo: 'TERCERA. Plazo.', texto: 'El Contratista se obliga a ejecutar y entregar el objeto del contrato en el plazo indicado en el cuadro de información, contado a partir de la fecha de inicio allí señalada. Las prórrogas solo tendrán validez si constan por escrito y de mutuo acuerdo.' },
    { id: 'cuarta', titulo: 'CUARTA. Obligaciones del Contratista.', texto: 'Ejecutar la obra con personal idóneo, cumpliendo las normas técnicas y de seguridad aplicables; responder por la calidad de los materiales y mano de obra; afiliar a su personal a seguridad social; mantener el sitio de trabajo en condiciones adecuadas de orden y seguridad; informar oportunamente al Contratante cualquier eventualidad que afecte el plazo o el alcance.' },
    { id: 'quinta', titulo: 'QUINTA. Obligaciones del Contratante.', texto: 'Entregar oportunamente la información, planos y accesos necesarios para ejecutar la obra; realizar los pagos conforme a las Órdenes de Compra aprobadas; designar un responsable de obra para la coordinación con el Contratista.' },
    { id: 'sexta', titulo: 'SEXTA. Calidad y materiales.', texto: 'Los materiales suministrados o instalados deben cumplir con las especificaciones acordadas. El Contratante podrá rechazar trabajos o materiales que no cumplan lo pactado, y el Contratista deberá corregirlos sin costo adicional.' },
    { id: 'septima', titulo: 'SÉPTIMA. Garantía de la obra.', texto: 'El Contratista garantiza la obra ejecutada por el período de garantía indicado en el cuadro de información, contado desde la fecha de entrega, respondiendo sin costo adicional por defectos de construcción o instalación imputables a su labor.' },
    { id: 'octava', titulo: 'OCTAVA. Pólizas.', texto: 'Cuando este contrato tenga pólizas marcadas en el cuadro respectivo, el Contratista se obliga a constituirlas a su costo y a favor del Contratante, con las coberturas y vigencias allí indicadas, dentro de los cinco (5) días siguientes a la firma de este contrato.' },
    { id: 'novena', titulo: 'NOVENA. Terminación.', texto: 'Este contrato podrá darse por terminado antes del plazo pactado por incumplimiento grave de cualquiera de las partes, por mutuo acuerdo, o por imposibilidad de ejecutar la obra por causas de fuerza mayor. En caso de terminación anticipada, se liquidará únicamente lo efectivamente ejecutado y soportado en Órdenes de Compra.' },
    { id: 'decima', titulo: 'DÉCIMA. Autonomía del Contratista.', texto: 'El Contratista actúa de manera independiente y autónoma, sin que se genere relación laboral, de dependencia o subordinación con el Contratante ni con su personal. El Contratista es responsable de sus propias obligaciones legales, laborales y de seguridad social frente a su personal.' },
    { id: 'decimaPrimera', titulo: 'DÉCIMA PRIMERA. Modificaciones y cesión.', texto: 'Cualquier modificación a este contrato debe constar por escrito y firmarse por ambas partes. El Contratista no podrá ceder este contrato ni subcontratar el alcance total sin autorización previa y escrita del Contratante.' },
  ],
  MANO_DE_OBRA: [
    { id: 'primera', titulo: 'PRIMERA. Objeto.', texto: 'El Contratista se obliga con el Contratante a ejecutar, con su propio personal, la mano de obra descrita en el cuadro de información de este contrato, en el inmueble allí señalado, conforme a las especificaciones, planos e instrucciones entregadas por el Contratante. Los materiales principales para la ejecución serán suministrados por el Contratante, salvo que expresamente se acuerde que el Contratista aporte algún material menor.' },
    { id: 'segunda', titulo: 'SEGUNDA. Valor y forma de pago.', texto: 'El valor del presente contrato es el indicado en el cuadro de información. El pago se realizará mediante Órdenes de Compra parciales expedidas por el Contratante a medida que se ejecuten y aprueben cortes de obra, cada una con su propio soporte y detalle. Si este contrato tiene anticipo (ver cuadro de Pólizas), este se amortizará contra dichas Órdenes de Compra hasta agotarse.' },
    { id: 'tercera', titulo: 'TERCERA. Plazo.', texto: 'El Contratista se obliga a ejecutar y entregar el objeto del contrato en el plazo indicado en el cuadro de información, contado a partir de la fecha de inicio allí señalada. Las prórrogas solo tendrán validez si constan por escrito y de mutuo acuerdo.' },
    { id: 'cuarta', titulo: 'CUARTA. Obligaciones del Contratista.', texto: 'Ejecutar la mano de obra con personal idóneo, cumpliendo las normas técnicas y de seguridad aplicables; aportar la herramienta menor necesaria para su labor; afiliar a su personal a seguridad social; mantener el sitio de trabajo en condiciones adecuadas de orden y seguridad; dar uso adecuado y cuidadoso a los materiales y a la herramienta mayor que le entregue el Contratante; informar oportunamente al Contratante cualquier eventualidad que afecte el plazo o el alcance.' },
    { id: 'quinta', titulo: 'QUINTA. Obligaciones del Contratante.', texto: 'Suministrar oportunamente los materiales, insumos y herramienta mayor necesarios para la ejecución de la obra, salvo el material menor que le corresponda al Contratista según lo acordado; entregar la información, planos y accesos necesarios; realizar los pagos conforme a las Órdenes de Compra aprobadas; designar un responsable de obra para la coordinación con el Contratista.' },
    { id: 'sexta', titulo: 'SEXTA. Uso de materiales y calidad de la ejecución.', texto: 'El Contratista deberá dar uso adecuado y cuidadoso a los materiales y herramienta que le entregue el Contratante, evitando desperdicios; cualquier daño o pérdida imputable a mal manejo del Contratista será asumido por este. Además, el Contratista garantiza la buena calidad en la ejecución de las actividades a su cargo, respondiendo por la correcta instalación y mano de obra, así el defecto no provenga de los materiales suministrados por el Contratante.' },
    { id: 'septima', titulo: 'SÉPTIMA. Garantía de la mano de obra.', texto: 'El Contratista garantiza la correcta ejecución de su mano de obra por el período de garantía indicado en el cuadro de información, contado desde la fecha de entrega, respondiendo sin costo adicional por defectos de instalación o ejecución imputables a su labor. Esta garantía no cubre defectos originados en los materiales suministrados por el Contratante.' },
    { id: 'octava', titulo: 'OCTAVA. Pólizas.', texto: 'Cuando este contrato tenga pólizas marcadas en el cuadro respectivo, el Contratista se obliga a constituirlas a su costo y a favor del Contratante, con las coberturas y vigencias allí indicadas, dentro de los cinco (5) días siguientes a la firma de este contrato.' },
    { id: 'novena', titulo: 'NOVENA. Terminación.', texto: 'Este contrato podrá darse por terminado antes del plazo pactado por incumplimiento grave de cualquiera de las partes, por mutuo acuerdo, o por imposibilidad de ejecutar la obra por causas de fuerza mayor. En caso de terminación anticipada, se liquidará únicamente lo efectivamente ejecutado y soportado en Órdenes de Compra.' },
    { id: 'decima', titulo: 'DÉCIMA. Autonomía del Contratista.', texto: 'El Contratista actúa de manera independiente y autónoma, sin que se genere relación laboral, de dependencia o subordinación con el Contratante ni con su personal. El Contratista es responsable de sus propias obligaciones legales, laborales y de seguridad social frente a su personal.' },
    { id: 'decimaPrimera', titulo: 'DÉCIMA PRIMERA. Modificaciones y cesión.', texto: 'Cualquier modificación a este contrato debe constar por escrito y firmarse por ambas partes. El Contratista no podrá ceder este contrato ni subcontratar el alcance total sin autorización previa y escrita del Contratante.' },
  ],
  SUMINISTROS: [
    { id: 'primera', titulo: 'PRIMERA. Objeto.', texto: 'El Proveedor se obliga con el Contratante a suministrar y entregar los bienes y materiales descritos en el cuadro de información de este contrato, en el sitio y condiciones allí señalados, conforme a las especificaciones acordadas con el Contratante. Este contrato no incluye instalación ni ejecución de obra por parte del Proveedor.' },
    { id: 'segunda', titulo: 'SEGUNDA. Valor y forma de pago.', texto: 'El valor total de los bienes suministrados es el indicado en el cuadro de información. El pago se realizará mediante Órdenes de Compra parciales expedidas por el Contratante, contra la entrega efectiva de los bienes o según lo acordado en cada caso. Si este contrato tiene anticipo (ver cuadro de Pólizas), este se amortizará contra dichas Órdenes de Compra hasta agotarse.' },
    { id: 'tercera', titulo: 'TERCERA. Plazo y lugar de entrega.', texto: 'El Proveedor se obliga a entregar los bienes en el plazo indicado en el cuadro de información, contado a partir de la fecha de inicio allí señalada, en el sitio acordado con el Contratante. Las prórrogas solo tendrán validez si constan por escrito y de mutuo acuerdo.' },
    { id: 'cuarta', titulo: 'CUARTA. Obligaciones del Proveedor.', texto: 'Entregar los bienes con las especificaciones técnicas y de calidad acordadas; garantizar que estén libres de defectos de fabricación; entregar dentro del plazo pactado; informar oportunamente al Contratante cualquier eventualidad que afecte la entrega.' },
    { id: 'quinta', titulo: 'QUINTA. Obligaciones del Contratante.', texto: 'Recibir los bienes en el plazo y lugar acordados, o coordinar oportunamente su recibo; realizar los pagos conforme a lo pactado; informar oportunamente cualquier novedad sobre el sitio de entrega.' },
    { id: 'sexta', titulo: 'SEXTA. Calidad de los bienes.', texto: 'Los bienes suministrados deben cumplir con las especificaciones acordadas. El Contratante podrá rechazar los bienes que no cumplan lo pactado, y el Proveedor deberá reemplazarlos o corregirlos sin costo adicional.' },
    { id: 'septima', titulo: 'SÉPTIMA. Garantía de los bienes.', texto: 'El Proveedor garantiza los bienes suministrados por el período de garantía indicado en el cuadro de información (o la garantía de fábrica del fabricante, si esta es mayor), respondiendo por defectos de fabricación desde la fecha de entrega.' },
    { id: 'octava', titulo: 'OCTAVA. Pólizas.', texto: 'Cuando este contrato tenga pólizas marcadas en el cuadro respectivo, el Proveedor se obliga a constituirlas a su costo y a favor del Contratante, con las coberturas y vigencias allí indicadas, dentro de los cinco (5) días siguientes a la firma de este contrato.' },
    { id: 'novena', titulo: 'NOVENA. Terminación.', texto: 'Este contrato podrá darse por terminado antes del plazo pactado por incumplimiento grave de cualquiera de las partes, por mutuo acuerdo, o por imposibilidad de realizar el suministro por causas de fuerza mayor. En caso de terminación anticipada, se liquidará únicamente lo efectivamente entregado y soportado en Órdenes de Compra.' },
    { id: 'decima', titulo: 'DÉCIMA. Autonomía del Proveedor.', texto: 'El Proveedor actúa de manera independiente y autónoma, sin que se genere relación laboral, de dependencia o subordinación con el Contratante ni con su personal. El Proveedor es responsable de sus propias obligaciones legales, laborales y de seguridad social frente a su personal.' },
    { id: 'decimaPrimera', titulo: 'DÉCIMA PRIMERA. Modificaciones y cesión.', texto: 'Cualquier modificación a este contrato debe constar por escrito y firmarse por ambas partes. El Proveedor no podrá ceder este contrato ni subcontratar el suministro total sin autorización previa y escrita del Contratante.' },
  ],
};

// Siempre devuelve una COPIA nueva (nunca el array/objeto original de PLANTILLAS), para que
// nadie pueda mutar por accidente la plantilla al editar el texto de un contrato particular.
export function plantillaClausulas(tipoContrato) {
  const lista = PLANTILLAS[tipoContrato] || PLANTILLAS.SUMINISTRO_E_INSTALACION;
  return lista.map((c) => ({ id: c.id, titulo: c.titulo, texto: c.texto }));
}

// Dado un contrato ya guardado (con su columna `clausulas` como array JSON, o null si es
// viejo/no se ha guardado todavía), devuelve las cláusulas a mostrar: las propias del contrato
// si existen, o si no, la plantilla por defecto de su tipo — así nunca queda un contrato sin
// cláusulas que mostrar.
export function clausulasDelContrato(contrato) {
  if (Array.isArray(contrato?.clausulas) && contrato.clausulas.length) return contrato.clausulas;
  return plantillaClausulas(contrato?.tipo_contrato);
}
