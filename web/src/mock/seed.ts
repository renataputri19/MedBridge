/**
 * Pre-seeded catalogue for offline / demo mode.
 *
 * GENERATED FROM THE DATABASE. The catalogue below mirrors
 * database/seeders/CatalogueSeeder.php row for row, including the fixed UUIDs —
 * that pairing is what lets the mock and the live backend describe one world.
 * Hand-editing a row here without changing the seeder forks the two silently.
 *
 * Every hospital, hotel and place is VERIFIED AGAINST OPENSTREETMAP and carries
 * the element id it came from (`osmRef`). An earlier version of this file was
 * not: it held businesses that do not exist, at coordinates that pointed into
 * an industrial estate. If you add a row, look it up on openstreetmap.org first
 * — the PHP seeder throws without a source. See docs/09 D26.
 *
 * Coordinates and names: © OpenStreetMap contributors, ODbL. They exist so
 * distances can be COMPUTED; there is no map pin anywhere in this system, and
 * outbound links are a Google search by name (D24).
 *
 * WHAT IS STILL A FIXTURE: prices, star ratings, recovery certifications,
 * doctors, ferry schedules, and the six demo patients below. No business named
 * here is a contracted partner or knows this prototype exists.
 */
import { searchUrl } from '@/lib/geo'
import type {
  Doctor,
  FerryRoute,
  GroundTransport,
  Hospital,
  Hotel,
  Patient,
  Place,
  PlaceCategory,
  Procedure,
} from '@/types'

/** Openable proof a catalogue row is a real place. Mirrors `sourceUrl()` in PHP. */
const sourceUrl = (osmRef: string | null) =>
  osmRef ? `https://www.openstreetmap.org/${osmRef}` : null
/* ---------------------------------------------------------------------------- */
/* Hospitals — 3 Batam facilities                                               */
/* ---------------------------------------------------------------------------- */
export const HOSPITAL_IDS = {
  batamMedicalCenter: 'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d',
  awalBros: '6b02d857-9143-4ea6-bc78-5f4e10a93d6c',
  elisabeth: 'e91437ac-05d6-4b28-a9f1-73c26b8e5904',
} as const

export const hospitals: Hospital[] = [
  {
    id: HOSPITAL_IDS.batamMedicalCenter,
    name: 'RSBP Batam (Rumah Sakit Badan Pengusahaan)',
    district: 'Sekupang',
    address: 'Jl. Dr. Cipto Mangunkusumo, Sekupang, Batam 29422',
    accreditation: 'KARS Paripurna',
    specialties: ['Dental', 'Orthopedics', 'Health Screening', 'General Surgery'],
    minutesFromTerminal: 8,
    nearestTerminal: 'Sekupang Ferry Terminal',
    latitude: 1.130442,
    longitude: 103.931273,
    searchUrl: searchUrl('RSBP Batam (Rumah Sakit Badan Pengusahaan)'),
    sourceUrl: sourceUrl('way/782994070'),
  },
  {
    id: HOSPITAL_IDS.awalBros,
    name: 'Awal Bros Hospital Batam',
    district: 'Baloi',
    address: 'Jl. Gajah Mada Kav. 1, Baloi, Batam 29442',
    accreditation: 'KARS Paripurna',
    specialties: ['Ophthalmology', 'Cardiology', 'Orthopedics', 'Health Screening'],
    minutesFromTerminal: 15,
    nearestTerminal: 'Batam Centre Ferry Terminal',
    latitude: 1.124265,
    longitude: 104.016903,
    searchUrl: searchUrl('Awal Bros Hospital Batam'),
    sourceUrl: sourceUrl('way/783792352'),
  },
  {
    id: HOSPITAL_IDS.elisabeth,
    name: 'RS Santa Elisabeth Batam Kota',
    district: 'Batam Kota',
    address: 'Jl. Anggrek Blok II, Belian, Batam Kota, Batam 29464',
    accreditation: 'KARS Utama',
    specialties: ['Dental', 'Ophthalmology', 'Internal Medicine', 'General Surgery'],
    minutesFromTerminal: 12,
    nearestTerminal: 'Batam Centre Ferry Terminal',
    latitude: 1.107502,
    longitude: 104.079804,
    searchUrl: searchUrl('RS Santa Elisabeth Batam Kota'),
    sourceUrl: sourceUrl('way/1026585946'),
  },
]

/* ---------------------------------------------------------------------------- */
/* Doctors — indicative fixtures, not real clinicians                           */
/* ---------------------------------------------------------------------------- */
export const DOCTOR_IDS = {
  hartono: '4a7c1e93-2f85-4670-b3da-9c60e845f172',
  siregar: '8f36b2d0-c419-4a5e-97b6-2e08d51c7a43',
  wijaya: '1c5e70b4-6a92-483d-8f07-b64a2d90e5c1',
  lim: 'a03d69f7-5b14-4c8e-92a3-7d1e0f6b48c5',
  nasution: '72e148c6-9d03-4f51-ab87-3c95e60d21fa',
} as const

export const doctors: Doctor[] = [
  {
    id: DOCTOR_IDS.nasution,
    hospitalId: HOSPITAL_IDS.elisabeth,
    fullName: 'dr. Bimo Nasution, Sp.B',
    specialty: 'General & Digestive Surgery',
    qualifications: 'MD Univ. Sumatera Utara · Sp.B · FMAS',
    yearsExperience: 21,
    languages: ['English', 'Bahasa Indonesia'],
    consultationFeeSgd: 50,
  },
  {
    id: 'f2a6b58d-9017-4e34-a6c2-71d38b05e94f',
    hospitalId: HOSPITAL_IDS.awalBros,
    fullName: 'dr. Dimas Kurniawan, Sp.OT',
    specialty: 'Orthopedic & Sports Traumatology',
    qualifications: 'MD Univ. Diponegoro · Sp.OT',
    yearsExperience: 15,
    languages: ['English', 'Bahasa Indonesia'],
    consultationFeeSgd: 58,
  },
  {
    id: '9e31c7d0-5a84-4b19-83f6-c2074e91da6b',
    hospitalId: HOSPITAL_IDS.batamMedicalCenter,
    fullName: 'dr. Intan Permatasari, Sp.PD',
    specialty: 'Internal Medicine & Executive Screening',
    qualifications: 'MD Univ. Indonesia · Sp.PD',
    yearsExperience: 10,
    languages: ['English', 'Bahasa Indonesia', 'Mandarin'],
    consultationFeeSgd: 42,
  },
  {
    id: DOCTOR_IDS.wijaya,
    hospitalId: HOSPITAL_IDS.batamMedicalCenter,
    fullName: 'dr. Kevin Wijaya, Sp.OT',
    specialty: 'Orthopedic & Sports Traumatology',
    qualifications: 'MD Univ. Padjadjaran · Sp.OT · AOA Fellowship (SG)',
    yearsExperience: 14,
    languages: ['English', 'Bahasa Indonesia'],
    consultationFeeSgd: 60,
  },
  {
    id: DOCTOR_IDS.lim,
    hospitalId: HOSPITAL_IDS.elisabeth,
    fullName: 'dr. Michelle Lim, Sp.PD',
    specialty: 'Internal Medicine & Executive Screening',
    qualifications: 'MD Univ. Indonesia · Sp.PD · MRCP (UK)',
    yearsExperience: 12,
    languages: ['English', 'Bahasa Indonesia', 'Mandarin', 'Hokkien'],
    consultationFeeSgd: 40,
  },
  {
    id: '84d17e0c-3b26-4a95-9f18-e05c7a3d612b',
    hospitalId: HOSPITAL_IDS.awalBros,
    fullName: 'dr. Nadia Salim, Sp.PD',
    specialty: 'Internal Medicine & Executive Screening',
    qualifications: 'MD Univ. Padjadjaran · Sp.PD · MRCP (UK)',
    yearsExperience: 14,
    languages: ['English', 'Bahasa Indonesia', 'Malay'],
    consultationFeeSgd: 46,
  },
  {
    id: '5c9024ab-13e7-486f-b0d5-8a13f6e29c70',
    hospitalId: HOSPITAL_IDS.batamMedicalCenter,
    fullName: 'dr. Rangga Halim, Sp.B',
    specialty: 'General & Digestive Surgery',
    qualifications: 'MD Univ. Airlangga · Sp.B · FMAS',
    yearsExperience: 17,
    languages: ['English', 'Bahasa Indonesia'],
    consultationFeeSgd: 56,
  },
  {
    id: DOCTOR_IDS.siregar,
    hospitalId: HOSPITAL_IDS.awalBros,
    fullName: 'dr. Ratna Siregar, Sp.M',
    specialty: 'Ophthalmology — Refractive & Cataract',
    qualifications: 'MD Univ. Airlangga · Sp.M · FICO (UK)',
    yearsExperience: 19,
    languages: ['English', 'Bahasa Indonesia', 'Mandarin'],
    consultationFeeSgd: 55,
  },
  {
    id: '3b7e29a4-6d15-4f80-b3c7-05e9a26c8f14',
    hospitalId: HOSPITAL_IDS.elisabeth,
    fullName: 'dr. Yohanes Pratama, Sp.M',
    specialty: 'Ophthalmology — Cataract & Anterior Segment',
    qualifications: 'MD Univ. Gadjah Mada · Sp.M',
    yearsExperience: 13,
    languages: ['English', 'Bahasa Indonesia'],
    consultationFeeSgd: 48,
  },
  {
    id: DOCTOR_IDS.hartono,
    hospitalId: HOSPITAL_IDS.batamMedicalCenter,
    fullName: 'drg. Andrew Hartono, Sp.Pros',
    specialty: 'Prosthodontics & Dental Implantology',
    qualifications: 'DDS Univ. Indonesia · Sp.Pros · ITI Implant Fellow',
    yearsExperience: 16,
    languages: ['English', 'Bahasa Indonesia', 'Hokkien'],
    consultationFeeSgd: 45,
  },
  {
    id: 'd5108b3e-47a9-4c62-90f1-6b28e04d7395',
    hospitalId: HOSPITAL_IDS.elisabeth,
    fullName: 'drg. Sarah Tanuwijaya, Sp.KG',
    specialty: 'Dental & Restorative Implantology',
    qualifications: 'DDS Univ. Trisakti · Sp.KG · ICOI Fellow',
    yearsExperience: 11,
    languages: ['English', 'Bahasa Indonesia', 'Mandarin'],
    consultationFeeSgd: 38,
  },
]

/* ---------------------------------------------------------------------------- */
/* Procedures                                                                   */
/* ---------------------------------------------------------------------------- */
export const PROCEDURE_IDS = {
  healthScreening: '5f18a6c2-70d4-4931-bc0e-9a27f4e63b18',
  endoscopy: '7a21c48e-0f36-4d95-8b62-1e94a5c7038d',
  lasik: 'b6432ed9-18a5-4c70-93f6-0e51d8b7a42c',
  dentalImplant: '0d9b53e7-4c16-42a8-9f70-6b3e18d5a29c',
  cataract: '39c07f5b-6e21-4a8d-b054-7f92c31e6d80',
  kneeArthroscopy: 'e850d16f-2b93-4708-a5c1-4d68b09f7e23',
} as const

export const procedures: Procedure[] = [
  {
    id: PROCEDURE_IDS.healthScreening,
    code: 'SCR-EXE-01',
    name: 'Executive Health Screening (comprehensive)',
    category: 'SCREENING',
    description:
      'Full blood panel, tumour markers, ECG, chest X-ray, abdominal ultrasound, and same-day physician consultation.',
    sgBenchmarkSgd: 1250,
    batamPriceSgd: 320,
    treatmentDays: 1,
    recoveryNights: 0,
    requiresDoctorReview: false,
  },
  {
    id: PROCEDURE_IDS.endoscopy,
    code: 'GEN-ENDO-01',
    name: 'Gastroscopy + Colonoscopy Package',
    category: 'GENERAL_SURGERY',
    description:
      'Dual endoscopy under sedation with biopsy if indicated, histopathology and specialist report within 72 hours.',
    sgBenchmarkSgd: 2400,
    batamPriceSgd: 780,
    treatmentDays: 1,
    recoveryNights: 1,
    requiresDoctorReview: false,
  },
  {
    id: PROCEDURE_IDS.lasik,
    code: 'OPH-LSK-01',
    name: 'LASIK Refractive Surgery (both eyes)',
    category: 'OPHTHALMOLOGY',
    description:
      'Femtosecond bladeless LASIK for both eyes including pre-op topography, medication pack and 1-week review.',
    sgBenchmarkSgd: 3800,
    batamPriceSgd: 1480,
    treatmentDays: 1,
    recoveryNights: 1,
    requiresDoctorReview: true,
  },
  {
    id: PROCEDURE_IDS.dentalImplant,
    code: 'DEN-IMP-01',
    name: 'Dental Implant (single tooth, incl. crown)',
    category: 'DENTAL',
    description:
      'Titanium implant fixture, abutment and porcelain-fused-to-zirconia crown. Includes CBCT scan and two follow-up visits.',
    sgBenchmarkSgd: 4800,
    batamPriceSgd: 1450,
    treatmentDays: 2,
    recoveryNights: 1,
    requiresDoctorReview: false,
  },
  {
    id: PROCEDURE_IDS.cataract,
    code: 'OPH-CAT-01',
    name: 'Cataract Surgery (per eye, phaco + IOL)',
    category: 'OPHTHALMOLOGY',
    description:
      'Phacoemulsification with monofocal intraocular lens implant, day-surgery theatre and post-op medication.',
    sgBenchmarkSgd: 5400,
    batamPriceSgd: 1850,
    treatmentDays: 1,
    recoveryNights: 2,
    requiresDoctorReview: true,
  },
  {
    id: PROCEDURE_IDS.kneeArthroscopy,
    code: 'ORT-KNE-01',
    name: 'Knee Arthroscopy (meniscus repair)',
    category: 'ORTHOPEDICS',
    description:
      'Diagnostic and therapeutic arthroscopy with meniscal repair, spinal anaesthesia, one inpatient night and physiotherapy briefing.',
    sgBenchmarkSgd: 12500,
    batamPriceSgd: 4200,
    treatmentDays: 2,
    recoveryNights: 3,
    requiresDoctorReview: true,
  },
]

/* ---------------------------------------------------------------------------- */
/* Ferry routes — indicative schedules and fares                                */
/* ---------------------------------------------------------------------------- */
export const FERRY_IDS = {
  batamFastOut: 'c2e60849-7b13-4a5f-90d8-6e34b17c9f25',
  sindoOut: '4d871ba6-3e09-42c7-b51f-8a0e69d3c247',
  majesticOut: '86f30d2c-591a-4e73-8206-b7d4a15fe609',
  batamFastReturn: '2b95e714-6c80-4f3a-9d17-05e8c26ba49f',
  sindoReturn: 'fa03c86d-1e57-4920-b8c4-73a06d1f5e82',
  horizonReturn: '15c7e903-8d42-4b61-a07f-9c25e83b6d04',
} as const

export const ferryRoutes: FerryRoute[] = [
  {
    id: FERRY_IDS.sindoReturn,
    operator: 'Sindo Ferry',
    direction: 'BATAM_TO_SG',
    departTerminal: 'Sekupang Ferry Terminal',
    arriveTerminal: 'HarbourFront Centre, Singapore',
    departureTime: '16:00',
    arrivalTime: '16:50',
    durationMinutes: 50,
    priceSgd: 31,
  },
  {
    id: FERRY_IDS.batamFastReturn,
    operator: 'Batam Fast Ferry',
    direction: 'BATAM_TO_SG',
    departTerminal: 'Batam Centre Ferry Terminal',
    arriveTerminal: 'HarbourFront Centre, Singapore',
    departureTime: '17:30',
    arrivalTime: '18:30',
    durationMinutes: 60,
    priceSgd: 29,
  },
  {
    id: FERRY_IDS.horizonReturn,
    operator: 'Horizon Fast Ferry',
    direction: 'BATAM_TO_SG',
    departTerminal: 'Batam Centre Ferry Terminal',
    arriveTerminal: 'HarbourFront Centre, Singapore',
    departureTime: '19:00',
    arrivalTime: '20:00',
    durationMinutes: 60,
    priceSgd: 33,
  },
  {
    id: FERRY_IDS.batamFastOut,
    operator: 'Batam Fast Ferry',
    direction: 'SG_TO_BATAM',
    departTerminal: 'HarbourFront Centre, Singapore',
    arriveTerminal: 'Batam Centre Ferry Terminal',
    departureTime: '08:00',
    arrivalTime: '09:00',
    durationMinutes: 60,
    priceSgd: 29,
  },
  {
    id: FERRY_IDS.sindoOut,
    operator: 'Sindo Ferry',
    direction: 'SG_TO_BATAM',
    departTerminal: 'HarbourFront Centre, Singapore',
    arriveTerminal: 'Sekupang Ferry Terminal',
    departureTime: '08:40',
    arrivalTime: '09:30',
    durationMinutes: 50,
    priceSgd: 31,
  },
  {
    id: FERRY_IDS.majesticOut,
    operator: 'Majestic Fast Ferry',
    direction: 'SG_TO_BATAM',
    departTerminal: 'HarbourFront Centre, Singapore',
    arriveTerminal: 'Batam Centre Ferry Terminal',
    departureTime: '10:20',
    arrivalTime: '11:20',
    durationMinutes: 60,
    priceSgd: 27,
  },
]

/* ---------------------------------------------------------------------------- */
/* Recovery hotels                                                              */
/* ---------------------------------------------------------------------------- */

/**
 * No distance field, on purpose. How far each one is from "the hospital"
 * depends on which of the three the patient chose, so it is computed against
 * their choice rather than stored here. See docs/09 D21.
 */
export const HOTEL_IDS = {
  harrisBatamCentre: '6e40b18f-2c75-4a93-80d6-5b17e9c04af2',
  radissonGolf: 'd38c05a7-9f61-42be-b74c-08e35d1a9762',
  nagoyaHill: '0b7f24e5-6a38-4d19-9c05-e2416b8fa73d',
  bestWesternPanbil: '9c1e805b-4d72-46af-83e1-7a069c5b21ed',
} as const

export const hotels: Hotel[] = [
  {
    id: HOTEL_IDS.nagoyaHill,
    name: 'Nagoya Hill Hotel Batam',
    district: 'Nagoya',
    starRating: 3,
    nightlyRateSgd: 41,
    latitude: 1.147532,
    longitude: 104.012855,
    searchUrl: searchUrl('Nagoya Hill Hotel Batam'),
    sourceUrl: sourceUrl('way/616123913'),
    amenities: ['Mall access', 'Late check-out', 'Wi-Fi'],
    medicalRecoveryCertified: false,
  },
  {
    id: HOTEL_IDS.bestWesternPanbil,
    name: 'Best Western Premier Panbil',
    district: 'Muka Kuning',
    starRating: 4,
    nightlyRateSgd: 58,
    latitude: 1.082349,
    longitude: 104.030035,
    searchUrl: searchUrl('Best Western Premier Panbil'),
    sourceUrl: sourceUrl('way/543028102'),
    amenities: ['Quiet recovery wing', 'Soft-diet menu', 'Lift access', 'Wi-Fi'],
    medicalRecoveryCertified: true,
  },
  {
    id: HOTEL_IDS.harrisBatamCentre,
    name: 'HARRIS Hotel Batam Center',
    district: 'Batam Kota',
    starRating: 4,
    nightlyRateSgd: 62,
    latitude: 1.130514,
    longitude: 104.054035,
    searchUrl: searchUrl('HARRIS Hotel Batam Center'),
    sourceUrl: sourceUrl('node/5526812905'),
    amenities: ['Soft-diet room service', 'Ferry terminal shuttle', 'Lift access', 'Wi-Fi'],
    medicalRecoveryCertified: true,
  },
  {
    id: HOTEL_IDS.radissonGolf,
    name: 'Radisson Golf & Convention Center Batam',
    district: 'Batam Kota',
    starRating: 5,
    nightlyRateSgd: 84,
    latitude: 1.103554,
    longitude: 104.031796,
    searchUrl: searchUrl('Radisson Golf & Convention Center Batam'),
    sourceUrl: sourceUrl('way/575205306'),
    amenities: ['24h in-room dining', 'Wheelchair-accessible rooms', 'On-call nurse', 'Wi-Fi'],
    medicalRecoveryCertified: true,
  },
]

/* ---------------------------------------------------------------------------- */
/* Places — suggestions, never quote lines                                      */
/* ---------------------------------------------------------------------------- */

/**
 * NOTHING HERE IS PRICED. There is no `priceSgd` field, so a place cannot enter
 * a bundle, a total, or the Singapore savings comparison even by accident.
 * `priceLevel` is a guidebook band, the way a review site means "$$".
 *
 * `tags` is what the recovery filter matches on: `soft-diet` is why a congee
 * shop is the first thing a dental implant patient sees, and `sun-exposed` is
 * why a cataract patient is never shown a beach. See docs/09 D22.
 */
export const PLACE_IDS = {
  buburJakarta: '3e61d20f-9a48-4c75-b1d9-04f8267ae53c',
  gadoGadoGembira: '05b93c7e-4f81-4a20-8d6b-19e7c25f40a3',
  goldenPrawn933: '1f4a7c62-83d0-4e19-9a25-6b70c4d81e35',
  harbourBaySeafoodRestaurant: '7b2e05d1-c964-4a37-8f61-25d0e93b7a48',
  mieTerempaKBatamCenter: '42e9b7a5-6013-4d8c-a75f-90b2e34c1867',
  moon: '8a4c7e30-1d59-4b86-92f0-6c53d18b0a74',
  rmPadangSederhana: 'b7130e59-8c24-4f06-a93d-52681ce74b0f',
  supIkanYongKee: 'c58d1930-2a7f-4b64-90e8-73c15a6f2d09',
  weyWeySeafood: '9d07c4e8-5b26-4f13-8206-c4a71e5d93b0',
  grandBatamMall: '5a72e0d3-6f19-4c48-b25e-90c7d146a8f3',
  harbourBayMall: '0e58b3a7-2d61-4790-8c34-b7e1520fd69c',
  kepriMall: 'e40b7592-13c8-4d6a-95f7-8b02e61ac934',
  megaMallBatamCentre: '24d80f16-5e93-4b7c-8a01-c67d3f95e2b8',
  nagoyaHillShoppingCentre: '6c2f81d4-70a3-4e59-b846-0d19f37c25ea',
  panbilMall: 'f169c50e-7b34-4a82-9d6f-3081b57ce24a',
  marinaWaterfrontSekupang: '7ec40b18-3d95-4620-a8f7-14b06e93c25d',
  nongsaBeach: 'a3c17e05-9482-4b31-96da-7f0523c8e14b',
  hutanWisataMataKucing: '4b0d9e63-a527-4f18-89c1-3e76b02d514f',
  kebunRayaBatam: '91f6a2c7-08e5-4d34-b7a9-6c25e10f8b43',
  ocarinaPark: 'cf3820a5-6e14-4b97-a052-8d139c67e40b',
  batamCableSki: '2d61f047-8b93-4c15-a70e-63f8b104d259',
  viharaDutaMaitreya: '62a5d70c-1f89-4e35-b6c8-04729ad3f156',
} as const

const PLACE_ROWS = [
  {
    id: PLACE_IDS.buburJakarta,
    name: 'Bubur Jakarta',
    category: 'RESTAURANT',
    district: 'Nagoya',
    description:
      'Rice porridge and congee, plain or with chicken. The obvious first meal when chewing is off the table.',
    latitude: 1.143372,
    longitude: 104.011463,
    priceLevel: 1,
    osmRef: 'node/736609690',
    guideUrl: null,
    tags: ['soft-diet', 'quiet', 'indoor', 'step-free'],
  },
  {
    id: PLACE_IDS.gadoGadoGembira,
    name: 'Gado-Gado Gembira',
    category: 'RESTAURANT',
    district: 'Nagoya',
    description:
      'Blanched vegetables and peanut sauce, done properly. Meat-free by construction.',
    latitude: 1.14638,
    longitude: 104.00907,
    priceLevel: 1,
    osmRef: 'node/736621123',
    guideUrl: null,
    tags: ['vegetarian', 'halal', 'indoor', 'quiet'],
  },
  {
    id: PLACE_IDS.goldenPrawn933,
    name: 'Golden Prawn 933',
    category: 'RESTAURANT',
    district: 'Bengkong',
    description:
      'Batam\'s oldest and best-known seafood restaurant, built out over the water at Bengkong Laut. Chilli crab, butter prawns, steamed fish.',
    latitude: 1.1603,
    longitude: 104.03718,
    priceLevel: 3,
    osmRef: 'node/903121912',
    guideUrl: 'https://blog.batamfast.com/batam-seafood-restaurant/',
    tags: ['halal', 'spicy', 'crunchy', 'family-friendly', 'crowded', 'outdoor'],
  },
  {
    id: PLACE_IDS.harbourBaySeafoodRestaurant,
    name: 'Harbour Bay Seafood Restaurant',
    category: 'RESTAURANT',
    district: 'Jodoh',
    description:
      'Salted egg crab and black pepper crayfish, a few minutes from the Harbour Bay ferry terminal.',
    latitude: 1.15464,
    longitude: 103.996276,
    priceLevel: 3,
    osmRef: 'node/4599681496',
    guideUrl: 'https://eatbook.sg/batam-food-guide/',
    tags: ['halal', 'spicy', 'crunchy', 'family-friendly', 'crowded'],
  },
  {
    id: PLACE_IDS.mieTerempaKBatamCenter,
    name: 'Mie Terempa\'k Batam Center',
    category: 'RESTAURANT',
    district: 'Batam Kota',
    description:
      'Mie tarempa — the Riau Islands noodle dish — with beef or seafood. Quick, cheap, and close to the terminal.',
    latitude: 1.115193,
    longitude: 104.054084,
    priceLevel: 1,
    osmRef: 'node/4599681392',
    guideUrl: 'https://eatbook.sg/batam-food-guide/',
    tags: ['halal', 'spicy', 'indoor'],
  },
  {
    id: PLACE_IDS.moon,
    name: 'Moon',
    category: 'RESTAURANT',
    district: 'Nagoya',
    description:
      'Indonesian-Chinese cooking, entirely meat-free — tagged vegetarian-only in OpenStreetMap.',
    latitude: 1.14638,
    longitude: 104.00854,
    priceLevel: 1,
    osmRef: 'node/736621124',
    guideUrl: null,
    tags: ['vegetarian', 'soft-diet', 'quiet', 'indoor', 'air-conditioned'],
  },
  {
    id: PLACE_IDS.rmPadangSederhana,
    name: 'RM Padang Sederhana',
    category: 'RESTAURANT',
    district: 'Nagoya',
    description:
      'Padang rice with a dozen dishes brought to the table. Generous, fast, and hot in every sense.',
    latitude: 1.14198,
    longitude: 104.01235,
    priceLevel: 1,
    osmRef: 'node/736610278',
    guideUrl: null,
    tags: ['halal', 'spicy', 'indoor'],
  },
  {
    id: PLACE_IDS.supIkanYongKee,
    name: 'Sup Ikan Yong Kee',
    category: 'RESTAURANT',
    district: 'Batam Kota',
    description:
      'Sliced fish soup, and prawn and squid soup, in clear broth. The Batam staple, and the easiest thing to eat when chewing is uncomfortable.',
    latitude: 1.12835,
    longitude: 104.05033,
    priceLevel: 2,
    osmRef: 'node/857038137',
    guideUrl: 'https://eatbook.sg/batam-food-guide/',
    tags: ['soft-diet', 'halal', 'indoor', 'english-spoken'],
  },
  {
    id: PLACE_IDS.weyWeySeafood,
    name: 'Wey Wey Seafood',
    category: 'RESTAURANT',
    district: 'Jodoh',
    description:
      'Long-running local seafood house near Harbour Bay, regularly named in Batam eating guides.',
    latitude: 1.15253,
    longitude: 103.99804,
    priceLevel: 2,
    osmRef: 'node/703813205',
    guideUrl: 'https://blog.batamfast.com/batam-seafood-restaurant/',
    tags: ['halal', 'spicy', 'crunchy', 'crowded'],
  },
  {
    id: PLACE_IDS.grandBatamMall,
    name: 'Grand Batam Mall',
    category: 'MALL',
    district: 'Baloi',
    description:
      'Smaller Baloi mall with a supermarket and a pharmacy, close to the hospitals on Gajah Mada.',
    latitude: 1.135339,
    longitude: 104.007797,
    priceLevel: 2,
    osmRef: 'node/9355230187',
    guideUrl: null,
    tags: ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'quiet'],
  },
  {
    id: PLACE_IDS.harbourBayMall,
    name: 'Harbour Bay Mall',
    category: 'MALL',
    district: 'Jodoh',
    description:
      'Waterfront mall attached to the Harbour Bay ferry terminal, with a duty-free hall.',
    latitude: 1.154253,
    longitude: 104.001147,
    priceLevel: 2,
    osmRef: 'way/253921747',
    guideUrl: null,
    tags: ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free'],
  },
  {
    id: PLACE_IDS.kepriMall,
    name: 'Kepri Mall',
    category: 'MALL',
    district: 'Batam Kota',
    description:
      'Everyday mall on the Batam Kota side — groceries, a food hall, and lifts to every floor.',
    latitude: 1.100859,
    longitude: 104.036697,
    priceLevel: 2,
    osmRef: 'way/577003448',
    guideUrl: null,
    tags: ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'family-friendly'],
  },
  {
    id: PLACE_IDS.megaMallBatamCentre,
    name: 'Mega Mall Batam Centre',
    category: 'MALL',
    district: 'Batam Kota',
    description:
      'Beside the Batam Centre ferry terminal — the obvious place to wait out a few hours before a crossing.',
    latitude: 1.12924,
    longitude: 104.055977,
    priceLevel: 2,
    osmRef: 'way/606276855',
    guideUrl: null,
    tags: ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'crowded'],
  },
  {
    id: PLACE_IDS.nagoyaHillShoppingCentre,
    name: 'Nagoya Hill Shopping Centre',
    category: 'MALL',
    district: 'Nagoya',
    description:
      'Batam\'s largest mall: pharmacy, supermarket, food court and cinema under one roof.',
    latitude: 1.146271,
    longitude: 104.012614,
    priceLevel: 2,
    osmRef: 'way/59398752',
    guideUrl: null,
    tags: ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'family-friendly', 'crowded'],
  },
  {
    id: PLACE_IDS.panbilMall,
    name: 'Panbil Mall',
    category: 'MALL',
    district: 'Muka Kuning',
    description:
      'Quiet mall in the Panbil estate, a short walk from the hotel of the same name.',
    latitude: 1.0721,
    longitude: 104.023548,
    priceLevel: 2,
    osmRef: 'way/599509067',
    guideUrl: null,
    tags: ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'quiet'],
  },
  {
    id: PLACE_IDS.marinaWaterfrontSekupang,
    name: 'Marina Waterfront, Sekupang',
    category: 'BEACH',
    district: 'Sekupang',
    description:
      'West-coast waterfront with a promenade and sunset views back towards the mainland.',
    latitude: 1.08299,
    longitude: 103.932388,
    priceLevel: 1,
    osmRef: 'node/702331547',
    guideUrl: null,
    tags: ['outdoor', 'sun-exposed', 'family-friendly'],
  },
  {
    id: PLACE_IDS.nongsaBeach,
    name: 'Nongsa Beach',
    category: 'BEACH',
    district: 'Nongsa',
    description:
      'The calm north-east stretch facing Singapore, with resort day passes and a flat walk along the sand.',
    latitude: 1.194678,
    longitude: 104.088963,
    priceLevel: 1,
    osmRef: 'way/482249158',
    guideUrl: null,
    tags: ['outdoor', 'sun-exposed', 'family-friendly', 'strenuous'],
  },
  {
    id: PLACE_IDS.hutanWisataMataKucing,
    name: 'Hutan Wisata Mata Kucing',
    category: 'PARK',
    district: 'Sei Ladi',
    description:
      'Recreational forest park with walking paths under mature trees, minutes from the city.',
    latitude: 1.085136,
    longitude: 103.971603,
    priceLevel: 1,
    osmRef: 'node/700645205',
    guideUrl: null,
    tags: ['outdoor', 'quiet', 'strenuous', 'family-friendly'],
  },
  {
    id: PLACE_IDS.kebunRayaBatam,
    name: 'Kebun Raya Batam',
    category: 'PARK',
    district: 'Nongsa',
    description:
      'Batam\'s botanical garden — shaded trails and planted collections across a large hillside site.',
    latitude: 1.17008,
    longitude: 104.081571,
    priceLevel: 1,
    osmRef: 'way/566675315',
    guideUrl: null,
    tags: ['outdoor', 'quiet', 'sun-exposed', 'strenuous'],
  },
  {
    id: PLACE_IDS.ocarinaPark,
    name: 'Ocarina Park',
    category: 'PARK',
    district: 'Batam Kota',
    description:
      'Seafront park by Batam Centre with a Ferris wheel, paved paths and food stalls along the water.',
    latitude: 1.15196,
    longitude: 104.05471,
    priceLevel: 1,
    osmRef: 'node/703856231',
    guideUrl: null,
    tags: ['outdoor', 'sun-exposed', 'family-friendly', 'step-free', 'crowded'],
  },
  {
    id: PLACE_IDS.batamCableSki,
    name: 'Batam Cable Ski',
    category: 'ATTRACTION',
    district: 'Sekupang',
    description:
      'Cable wakeboarding park on the west coast lagoon. Worth watching even if you are not going in.',
    latitude: 1.080273,
    longitude: 103.937805,
    priceLevel: 2,
    osmRef: 'node/624950721',
    guideUrl: null,
    tags: ['outdoor', 'sun-exposed', 'strenuous', 'family-friendly'],
  },
  {
    id: PLACE_IDS.viharaDutaMaitreya,
    name: 'Vihara Duta Maitreya',
    category: 'ATTRACTION',
    district: 'Sungai Panas',
    description:
      'One of the largest Buddhist temple complexes in the region. Calm, level throughout, and free to enter.',
    latitude: 1.129439,
    longitude: 104.034725,
    priceLevel: 0,
    osmRef: 'node/6865933721',
    guideUrl: null,
    tags: ['indoor', 'quiet', 'step-free', 'wheelchair-accessible'],
  },
] as const

/** Guidebook bands, mirroring `Place::priceBand()` in PHP. Never an amount. */
const PRICE_BANDS = ['Free', '$', '$$', '$$$', '$$$$'] as const

export const places: Place[] = PLACE_ROWS.map(({ latitude, longitude, osmRef, ...row }) => ({
  ...row,
  category: row.category as PlaceCategory,
  tags: [...row.tags],
  priceBand: PRICE_BANDS[row.priceLevel] ?? '$$$$',
  // Coordinates are dropped from the exported record — the API does not
  // serialise them either. They exist to derive distances, never to be stored
  // as one, and never to drop a pin.
  searchUrl: searchUrl(row.name),
  sourceUrl: sourceUrl(osmRef),
  guideUrl: row.guideUrl,
}))

/* ---------------------------------------------------------------------------- */
/* Ground transport                                                             */
/* ---------------------------------------------------------------------------- */
export const TRANSPORT_IDS = {
  privateCar: '3a86d0f4-15c9-4e27-b6a8-0d94f7e35c61',
  wheelchairVan: '7d29e5b1-08a6-4c34-95f7-b21e60d84a39',
  shuttle: 'e04b736a-5d18-49f2-8c60-1b73a95e20d4',
  ambulance: '58f13c9e-7204-4a86-b0d5-9e62c14f8b37',
} as const

export const groundTransport: GroundTransport[] = [
  {
    id: TRANSPORT_IDS.shuttle,
    type: 'SHUTTLE',
    provider: 'Hospital Partner Shuttle',
    description:
      'Shared scheduled shuttle between the ferry terminal and the partner hospital. Departs hourly.',
    priceSgd: 18,
    capacity: 12,
  },
  {
    id: TRANSPORT_IDS.privateCar,
    type: 'PRIVATE_CAR',
    provider: 'MedBridge Care Fleet',
    description:
      'Private air-conditioned sedan with English-speaking driver. Terminal pick-up, hospital and hotel transfers, return drop-off.',
    priceSgd: 48,
    capacity: 3,
  },
  {
    id: TRANSPORT_IDS.wheelchairVan,
    type: 'WHEELCHAIR_VAN',
    provider: 'MedBridge Care Fleet',
    description:
      'Wheelchair-accessible van with ramp and trained assistant for reduced-mobility patients.',
    priceSgd: 76,
    capacity: 4,
  },
  {
    id: TRANSPORT_IDS.ambulance,
    type: 'AMBULANCE',
    provider: 'Batam Emergency Medical Services',
    description:
      'Basic life-support ambulance with paramedic escort for post-operative or stretcher-bound transfers.',
    priceSgd: 165,
    capacity: 1,
  },
]

/* ---------------------------------------------------------------------------- */
/* Singapore patients — demo fixtures, frontend-only                            */
/* ---------------------------------------------------------------------------- */

/**
 * These six are invented, and that is fine: they are patients, not businesses.
 * Nobody can be misled into visiting a person who does not exist, and inventing
 * a real patient would be far worse. They never reach the database — the
 * backend seeder creates no patients at all, so the only PII in this system is
 * what a real visitor types at submit.
 *
 * Contact details arrive pre-masked here exactly as the API emits them, so the
 * mock cannot accidentally teach the UI to expect a raw phone number.
 */
export const PATIENT_IDS = {
  tanWeiMing: '3f2a1b7c-9d4e-4a81-b2c5-6e8f0a1d3c47',
  priyaMenon: '7c9e2d15-4b83-4f26-9a7d-1e5c8b0f2a63',
  jonathanLee: 'b1d84f92-6a07-4c53-8e1b-9f3d5a72c0e8',
  siti: '5e60c3a8-1f72-4d94-a6b8-2c7e9014fb35',
  marcusChia: '9a47b0e6-8c31-4e07-bf52-4d19a6c8e723',
  angelaKoh: '2d85f419-7e60-4b3a-8c94-a05f7d2e61b9',
} as const

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

export const patients: Patient[] = [
  {
    id: PATIENT_IDS.tanWeiMing,
    fullName: 'Tan Wei Ming',
    phoneMasked: '+65 •••• 412',
    emailMasked: 'we••••••@gmail.com',
    countryCode: 'SG',
    yearOfBirth: 1979,
    gender: 'M',
    preferredChannel: 'WEB',
    preferredLanguage: 'English',
    createdAt: daysAgo(9),
  },
  {
    id: PATIENT_IDS.priyaMenon,
    fullName: 'Priya Menon',
    phoneMasked: '+65 •••• 887',
    emailMasked: 'pr••••••@outlook.com',
    countryCode: 'SG',
    yearOfBirth: 1986,
    gender: 'F',
    preferredChannel: 'WEB',
    preferredLanguage: 'English',
    createdAt: daysAgo(7),
  },
  {
    id: PATIENT_IDS.jonathanLee,
    fullName: 'Jonathan Lee',
    phoneMasked: '+65 •••• 203',
    emailMasked: 'jo••••••@yahoo.com.sg',
    countryCode: 'SG',
    yearOfBirth: 1964,
    gender: 'M',
    preferredChannel: 'WEB',
    preferredLanguage: 'English',
    createdAt: daysAgo(6),
  },
  {
    id: PATIENT_IDS.siti,
    fullName: 'Siti Nurhaliza Rahman',
    phoneMasked: '+65 •••• 559',
    emailMasked: 'si••••••@gmail.com',
    countryCode: 'SG',
    yearOfBirth: 1991,
    gender: 'F',
    preferredChannel: 'WEB',
    preferredLanguage: 'English / Malay',
    createdAt: daysAgo(4),
  },
  {
    id: PATIENT_IDS.marcusChia,
    fullName: 'Marcus Chia',
    phoneMasked: '+65 •••• 731',
    emailMasked: 'ma••••••@hotmail.com',
    countryCode: 'SG',
    yearOfBirth: 1973,
    gender: 'M',
    preferredChannel: 'WEB',
    preferredLanguage: 'English',
    createdAt: daysAgo(3),
  },
  {
    id: PATIENT_IDS.angelaKoh,
    fullName: 'Angela Koh',
    phoneMasked: '+65 •••• 046',
    emailMasked: 'an••••••@gmail.com',
    countryCode: 'SG',
    yearOfBirth: 1957,
    gender: 'F',
    preferredChannel: 'WEB',
    preferredLanguage: 'English / Mandarin',
    createdAt: daysAgo(2),
  },
]

/* ---------------------------------------------------------------------------- */
/* Lookup maps                                                                  */
/* ---------------------------------------------------------------------------- */

export const byId = <T extends { id: string }>(rows: T[]) =>
  new Map(rows.map((row) => [row.id, row]))

export const hospitalMap = byId(hospitals)
export const doctorMap = byId(doctors)
export const procedureMap = byId(procedures)
export const patientMap = byId(patients)
export const hotelMap = byId(hotels)
export const placeMap = byId(places)
export const ferryMap = byId(ferryRoutes)
export const transportMap = byId(groundTransport)

/** Operations staff names used by the mock activity feed. Invented, like the patients. */
export const STAFF_NAMES = ['Nadia Putri', 'Rizky Pratama', 'Clara Tanuwijaya', 'Fajar Ramadhan']
                                                                                                                                                                                                                                                                                                                   