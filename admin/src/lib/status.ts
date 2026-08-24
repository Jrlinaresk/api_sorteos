const labels: Record<string, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  active: 'Activa',
  open: 'Abierta',
  expired: 'Vencida',
  sold_out: 'Agotada',
  awaiting_draw: 'Esperando sorteo',
  drawn: 'Sorteada',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
  reserved: 'Reservado',
  pending_payment: 'Pago pendiente',
  paid: 'Pagado',
  rejected: 'Rechazado',
  refunded: 'Devuelto',
  partially_refunded: 'Devolución parcial',
  refund_pending: 'Devolución pendiente',
  in_review: 'En revisión',
  under_review: 'En revisión',
  disputed: 'Disputado',
  chargeback: 'Contracargo',
  created: 'Creado',
  pending: 'Pendiente',
  failed: 'Fallido',
  awarded: 'Adjudicado',
  claimed: 'Reclamado',
  fulfilled: 'Entregado',
  reversed: 'Revertido',
  published: 'Publicada',
  archived: 'Archivada',
  verified: 'Verificado',
  processing: 'Procesando',
  sent: 'Enviada',
  partially_sent: 'Envío parcial',
  skipped: 'Omitida',
  success: 'Correcto',
  failure: 'Error',
};

const positive = new Set([
  'active',
  'open',
  'paid',
  'fulfilled',
  'published',
  'sent',
  'success',
]);
const warning = new Set([
  'scheduled',
  'pending',
  'pending_payment',
  'reserved',
  'awaiting_draw',
  'claimed',
  'refund_pending',
  'partially_refunded',
  'processing',
  'partially_sent',
  'in_review',
  'under_review',
]);
const negative = new Set([
  'failed',
  'rejected',
  'cancelled',
  'disputed',
  'chargeback',
  'failure',
]);

export function statusLabel(status?: string): string {
  if (!status) return 'Sin estado';
  return labels[status] ?? status.replaceAll('_', ' ');
}

export function statusTone(
  status?: string,
): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (!status) return 'neutral';
  if (positive.has(status)) return 'positive';
  if (warning.has(status)) return 'warning';
  if (negative.has(status)) return 'negative';
  return 'neutral';
}
