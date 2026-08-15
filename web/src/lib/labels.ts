/**
 * Display names for rows that arrive carrying foreign keys.
 *
 * THE BACKEND IS THE SOURCE OF TRUTH, and the mock is only a fallback.
 *
 * This file exists because the portal used to have it the other way round.
 * List payloads carry `patientId`, `procedureId` and `doctorId`, and every
 * screen resolved those to names by looking them up in `mock/seed.ts` — the
 * offline fixture. That works for seeded demo rows, whose UUIDs are pinned
 * identically in the mock and the database, and it fails for every real case:
 * a patient created by the chat exists only in the database, so the lookup
 * missed and the row rendered "Unknown patient" while the record was perfectly
 * intact one table away.
 *
 * So: prefer the name the API sent, fall back to the local map for offline
 * mode, and only then say we do not know.
 */
import { mockDb } from '@/mock/db'
import { doctorMap, patientMap, procedureMap } from '@/mock/seed'
import type { Inquiry, QuoteTotals, UUID } from '@/types'

/** A row that names its patient, or only points at one. */
interface PatientRef {
  patientId: UUID
  patientName?: string | null
}

interface ProcedureRef {
  procedureId?: UUID | null
  procedureName?: string | null
}

interface DoctorRef {
  doctorId?: UUID | null
  doctorName?: string | null
}

export function patientLabel(row: PatientRef, fallback = 'Unknown patient'): string {
  return row.patientName ?? patientMap.get(row.patientId)?.fullName ?? fallback
}

export function procedureLabel(row: ProcedureRef, fallback = 'Unmapped request'): string {
  if (row.procedureName) return row.procedureName
  if (row.procedureId) return procedureMap.get(row.procedureId)?.name ?? fallback
  return fallback
}

export function doctorLabel(row: DoctorRef, fallback = 'Unassigned'): string {
  if (row.doctorName) return row.doctorName
  if (row.doctorId) return doctorMap.get(row.doctorId)?.fullName ?? fallback
  return fallback
}

/* -------------------------------------------------------------------------- */
/* Figures, resolved the same way                                              */
/* -------------------------------------------------------------------------- */
/*
 * Not labels, but the identical precedence problem — so they live beside them
 * rather than being written out twice in the board and the table.
 *
 * The distinction that matters is null vs undefined. The API sends `null` when
 * a case genuinely has no quote or no extraction yet, and that must render as
 * an em dash. Only `undefined` — an offline mock row that predates these
 * fields — falls through to the local fixture.
 */

export function inquiryTotals(row: Inquiry): QuoteTotals | null {
  if (row.totals !== undefined) return row.totals
  return mockDb.getQuoteTotals(row.id)
}

export function inquiryConfidence(row: Inquiry): number | null {
  if (row.confidence !== undefined) return row.confidence
  return mockDb.getInquiry(row.id)?.aiExtraction?.confidence ?? null
}
