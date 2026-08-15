<?php

namespace Database\Seeders;

use App\Models\Doctor;
use App\Models\FerryRoute;
use App\Models\GroundTransport;
use App\Models\Hospital;
use App\Models\HospitalProcedure;
use App\Models\Hotel;
use App\Models\Place;
use App\Models\Procedure;
use Illuminate\Database\Seeder;

/**
 * The reference catalogue.
 *
 * Every id here is a FIXED UUID v4, identical to the ones in
 * web/src/mock/seed.ts. That is deliberate: the offline mock and the live
 * database describe the same world, so switching VITE_USE_MOCKS does not change
 * a single identifier on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY PLACE IN HERE IS VERIFIED AGAINST OPENSTREETMAP.
 *
 * An earlier version of this file was not, and it was worse than inaccurate. It
 * contained businesses that do not exist — "Kopitiam Ameng", "Bubur Ayam Akiaw
 * 99", "Vegetarian House Maitreya" — invented names at invented coordinates,
 * shipped under a docblock claiming the businesses named were real. One of them
 * plotted into the middle of an industrial estate in Baloi Permai. The hotels
 * were real but misplaced by up to 5.7 km, which meant every distance the app
 * computed was arithmetically perfect nonsense.
 *
 * So: `osm_ref` on every hospital, hotel and place, and `assertVerified()` at
 * the end of run() to fail the seed if one is missing. Provenance is not
 * documentation here, it is the check. A row nobody can look up is a row
 * somebody made up.
 *
 * Coordinates and names come from OpenStreetMap (© OpenStreetMap contributors,
 * ODbL). Look any of them up at https://www.openstreetmap.org/node/736609690
 * or /way/575205306.
 *
 * WHAT IS STILL NOT REAL: the prices, the recovery certifications, the
 * `hospital_procedure` rows, the doctors, and the ferry schedules. Those are
 * indicative fixtures, and no business named here is a contracted partner, has
 * agreed to anything, or knows this prototype exists. Verified coordinates make
 * that disclaimer MORE necessary, not less — a real pin on a real map is
 * exactly what makes a reader assume the rest is real too. See docs/09 D12,
 * D25, D26.
 * ─────────────────────────────────────────────────────────────────────────────
 */
class CatalogueSeeder extends Seeder
{
    public function run(): void
    {
        $this->hospitals();
        $this->doctors();
        $this->procedures();
        $this->hospitalProcedures();
        $this->ferryRoutes();
        $this->hotels();
        $this->groundTransport();
        $this->places();

        $this->assertVerified();
    }

    /**
     * No row on the map without a source.
     *
     * This is deliberately a hard failure rather than a warning. The previous
     * catalogue's invented businesses survived review precisely because nothing
     * in the system could tell the difference between a real place and a
     * convincing one — every layer downstream just trusted the seed. This is
     * the layer that stops trusting it.
     */
    private function assertVerified(): void
    {
        foreach ([Hospital::class, Hotel::class, Place::class] as $model) {
            $unverified = $model::whereNull('osm_ref')->orWhere('osm_ref', '')->pluck('name');

            if ($unverified->isNotEmpty()) {
                throw new \RuntimeException(sprintf(
                    "%s rows have no osm_ref and cannot be verified: %s.\n".
                    'Look the place up on openstreetmap.org and record its node/way id, or remove the row. '.
                    'Do not invent one.',
                    class_basename($model),
                    $unverified->implode(', '),
                ));
            }
        }
    }

    /**
     * Which hospital performs what, and at what price.
     *
     * A hospital is offered for a procedure only when it lists the matching
     * specialty — inventing capability a facility does not claim would be a
     * worse lie than any pricing approximation.
     *
     * Prices scale the catalogue base per facility, and the base is the FLOOR:
     * the cheapest eligible hospital charges exactly `procedures.batam_price_sgd`.
     * That keeps "from S$1,450" on the treatment chips literally true, and it
     * means the default plan is the one the patient was quoted up front.
     */
    private function hospitalProcedures(): void
    {
        $multipliers = [
            'e91437ac-05d6-4b28-a9f1-73c26b8e5904' => 1.00,   // RS Santa Elisabeth Batam Kota
            '6b02d857-9143-4ea6-bc78-5f4e10a93d6c' => 1.06,   // Awal Bros Batam
            'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d' => 1.15,   // RSBP Batam, Sekupang
        ];

        $specialtyFor = [
            'DENTAL' => 'Dental',
            'SCREENING' => 'Health Screening',
            'OPHTHALMOLOGY' => 'Ophthalmology',
            'ORTHOPEDICS' => 'Orthopedics',
            'GENERAL_SURGERY' => 'General Surgery',
        ];

        foreach (Procedure::all() as $procedure) {
            $specialty = $specialtyFor[$procedure->category] ?? null;
            if (! $specialty) {
                continue;
            }

            $eligible = Hospital::all()
                ->filter(fn (Hospital $h) => in_array($specialty, $h->specialties ?? [], true));

            if ($eligible->isEmpty()) {
                continue;
            }

            /*
             * Normalise per procedure so the cheapest ELIGIBLE facility lands
             * exactly on the base price. Without this, a procedure only the two
             * pricier hospitals perform would floor above its advertised "from"
             * figure — and a price a patient cannot actually reach is a lie,
             * however small.
             */
            $floor = $eligible->min(fn (Hospital $h) => $multipliers[$h->id]);

            foreach ($eligible as $hospital) {
                HospitalProcedure::updateOrCreate(
                    ['hospital_id' => $hospital->id, 'procedure_id' => $procedure->id],
                    [
                        'price_sgd' => round(
                            (float) $procedure->batam_price_sgd * ($multipliers[$hospital->id] / $floor),
                            0,
                        ),
                        'available' => true,
                    ],
                );
            }
        }
    }

    /**
     * Three real Batam hospitals, each checkable on OpenStreetMap.
     *
     * The UUIDs are unchanged because they are load-bearing — `web/src/mock/seed.ts`
     * and the test suite both pin them. The NAMES changed, because one of them
     * was fiction: "Batam Medical Center — Sekupang SEZ" does not exist. There
     * is a real "Batam Medical Centre" in OSM, but it is in Lubuk Baja, not
     * Sekupang, and the Sekupang branch was something this seeder made up to
     * have a hospital near that ferry terminal.
     *
     * The genuine Sekupang hospital is RSBP Batam, run by the Batam Indonesia
     * Free Zone Authority, and it takes that slot now.
     *
     * Accreditations and specialty lists remain indicative fixtures — only the
     * identity and the location are verified.
     *
     * Ratings and review counts are gone entirely rather than being fixtures.
     * "4.8 from 1,284 reviews" on a real hospital is not indicative of
     * anything: no one was surveyed, and a patient reading it while choosing
     * where to have surgery cannot tell that from a real figure. The link in
     * `searchUrl` goes to somewhere that does know.
     */
    private function hospitals(): void
    {
        foreach ([
            [
                'id' => 'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d',
                'name' => 'RSBP Batam (Rumah Sakit Badan Pengusahaan)',
                'district' => 'Sekupang',
                'address' => 'Jl. Dr. Cipto Mangunkusumo, Sekupang, Batam 29422',
                'accreditation' => 'KARS Paripurna',
                'specialties' => ['Dental', 'Orthopedics', 'Health Screening', 'General Surgery'],
                'minutes_from_terminal' => 8, 'nearest_terminal' => 'Sekupang Ferry Terminal',
                // West of the island, a few minutes from the Sekupang terminal
                // — which is why the Batam Centre hotels genuinely are far.
                'latitude' => 1.130442, 'longitude' => 103.931273,
                'osm_ref' => 'way/782994070',
            ],
            [
                'id' => '6b02d857-9143-4ea6-bc78-5f4e10a93d6c',
                'name' => 'Awal Bros Hospital Batam',
                'district' => 'Baloi',
                'address' => 'Jl. Gajah Mada Kav. 1, Baloi, Batam 29442',
                'accreditation' => 'KARS Paripurna',
                'specialties' => ['Ophthalmology', 'Cardiology', 'Orthopedics', 'Health Screening'],
                'minutes_from_terminal' => 15, 'nearest_terminal' => 'Batam Centre Ferry Terminal',
                'latitude' => 1.124265, 'longitude' => 104.016903,
                'osm_ref' => 'way/783792352',
            ],
            [
                'id' => 'e91437ac-05d6-4b28-a9f1-73c26b8e5904',
                'name' => 'RS Santa Elisabeth Batam Kota',
                'district' => 'Batam Kota',
                'address' => 'Jl. Anggrek Blok II, Belian, Batam Kota, Batam 29464',
                'accreditation' => 'KARS Utama',
                'specialties' => ['Dental', 'Ophthalmology', 'Internal Medicine', 'General Surgery'],
                'minutes_from_terminal' => 12, 'nearest_terminal' => 'Batam Centre Ferry Terminal',
                // Note this is the Batam Kota site, not the Lubuk Baja one —
                // there are two RS Santa Elisabeth hospitals on the island and
                // the previous coordinate sat between them, belonging to neither.
                'latitude' => 1.107502, 'longitude' => 104.079804,
                'osm_ref' => 'way/1026585946',
            ],
        ] as $row) {
            Hospital::updateOrCreate(['id' => $row['id']], $row);
        }
    }

    private function doctors(): void
    {
        foreach ([
            [
                'id' => '4a7c1e93-2f85-4670-b3da-9c60e845f172',
                'hospital_id' => 'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d',
                'full_name' => 'drg. Andrew Hartono, Sp.Pros',
                'specialty' => 'Prosthodontics & Dental Implantology',
                'qualifications' => 'DDS Univ. Indonesia · Sp.Pros · ITI Implant Fellow',
                'years_experience' => 16,
                'languages' => ['English', 'Bahasa Indonesia', 'Hokkien'],
                'consultation_fee_sgd' => 45,
            ],
            [
                'id' => '8f36b2d0-c419-4a5e-97b6-2e08d51c7a43',
                'hospital_id' => '6b02d857-9143-4ea6-bc78-5f4e10a93d6c',
                'full_name' => 'dr. Ratna Siregar, Sp.M',
                'specialty' => 'Ophthalmology — Refractive & Cataract',
                'qualifications' => 'MD Univ. Airlangga · Sp.M · FICO (UK)',
                'years_experience' => 19,
                'languages' => ['English', 'Bahasa Indonesia', 'Mandarin'],
                'consultation_fee_sgd' => 55,
            ],
            [
                'id' => '1c5e70b4-6a92-483d-8f07-b64a2d90e5c1',
                'hospital_id' => 'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d',
                'full_name' => 'dr. Kevin Wijaya, Sp.OT',
                'specialty' => 'Orthopedic & Sports Traumatology',
                'qualifications' => 'MD Univ. Padjadjaran · Sp.OT · AOA Fellowship (SG)',
                'years_experience' => 14,
                'languages' => ['English', 'Bahasa Indonesia'],
                'consultation_fee_sgd' => 60,
            ],
            [
                'id' => 'a03d69f7-5b14-4c8e-92a3-7d1e0f6b48c5',
                'hospital_id' => 'e91437ac-05d6-4b28-a9f1-73c26b8e5904',
                'full_name' => 'dr. Michelle Lim, Sp.PD',
                'specialty' => 'Internal Medicine & Executive Screening',
                'qualifications' => 'MD Univ. Indonesia · Sp.PD · MRCP (UK)',
                'years_experience' => 12,
                'languages' => ['English', 'Bahasa Indonesia', 'Mandarin', 'Hokkien'],
                'consultation_fee_sgd' => 40,
            ],
            [
                'id' => '72e148c6-9d03-4f51-ab87-3c95e60d21fa',
                'hospital_id' => 'e91437ac-05d6-4b28-a9f1-73c26b8e5904',
                'full_name' => 'dr. Bimo Nasution, Sp.B',
                'specialty' => 'General & Digestive Surgery',
                'qualifications' => 'MD Univ. Sumatera Utara · Sp.B · FMAS',
                'years_experience' => 21,
                'languages' => ['English', 'Bahasa Indonesia'],
                'consultation_fee_sgd' => 50,
            ],

            /*
             * Every specialty a hospital advertises needs someone who can
             * actually perform it. Without these, choosing Elisabeth for a
             * dental implant would assign an internal-medicine physician —
             * the patient's hospital choice has to stay clinically coherent.
             */
            [
                'id' => 'd5108b3e-47a9-4c62-90f1-6b28e04d7395',
                'hospital_id' => 'e91437ac-05d6-4b28-a9f1-73c26b8e5904',
                'full_name' => 'drg. Sarah Tanuwijaya, Sp.KG',
                'specialty' => 'Dental & Restorative Implantology',
                'qualifications' => 'DDS Univ. Trisakti · Sp.KG · ICOI Fellow',
                'years_experience' => 11,
                'languages' => ['English', 'Bahasa Indonesia', 'Mandarin'],
                'consultation_fee_sgd' => 38,
            ],
            [
                'id' => '3b7e29a4-6d15-4f80-b3c7-05e9a26c8f14',
                'hospital_id' => 'e91437ac-05d6-4b28-a9f1-73c26b8e5904',
                'full_name' => 'dr. Yohanes Pratama, Sp.M',
                'specialty' => 'Ophthalmology — Cataract & Anterior Segment',
                'qualifications' => 'MD Univ. Gadjah Mada · Sp.M',
                'years_experience' => 13,
                'languages' => ['English', 'Bahasa Indonesia'],
                'consultation_fee_sgd' => 48,
            ],
            [
                'id' => '9e31c7d0-5a84-4b19-83f6-c2074e91da6b',
                'hospital_id' => 'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d',
                'full_name' => 'dr. Intan Permatasari, Sp.PD',
                'specialty' => 'Internal Medicine & Executive Screening',
                'qualifications' => 'MD Univ. Indonesia · Sp.PD',
                'years_experience' => 10,
                'languages' => ['English', 'Bahasa Indonesia', 'Mandarin'],
                'consultation_fee_sgd' => 42,
            ],
            [
                'id' => '5c9024ab-13e7-486f-b0d5-8a13f6e29c70',
                'hospital_id' => 'c47a9e21-3b58-4d0f-9e63-8a15c7b04f2d',
                'full_name' => 'dr. Rangga Halim, Sp.B',
                'specialty' => 'General & Digestive Surgery',
                'qualifications' => 'MD Univ. Airlangga · Sp.B · FMAS',
                'years_experience' => 17,
                'languages' => ['English', 'Bahasa Indonesia'],
                'consultation_fee_sgd' => 56,
            ],
            [
                'id' => 'f2a6b58d-9017-4e34-a6c2-71d38b05e94f',
                'hospital_id' => '6b02d857-9143-4ea6-bc78-5f4e10a93d6c',
                'full_name' => 'dr. Dimas Kurniawan, Sp.OT',
                'specialty' => 'Orthopedic & Sports Traumatology',
                'qualifications' => 'MD Univ. Diponegoro · Sp.OT',
                'years_experience' => 15,
                'languages' => ['English', 'Bahasa Indonesia'],
                'consultation_fee_sgd' => 58,
            ],
            [
                'id' => '84d17e0c-3b26-4a95-9f18-e05c7a3d612b',
                'hospital_id' => '6b02d857-9143-4ea6-bc78-5f4e10a93d6c',
                'full_name' => 'dr. Nadia Salim, Sp.PD',
                'specialty' => 'Internal Medicine & Executive Screening',
                'qualifications' => 'MD Univ. Padjadjaran · Sp.PD · MRCP (UK)',
                'years_experience' => 14,
                'languages' => ['English', 'Bahasa Indonesia', 'Malay'],
                'consultation_fee_sgd' => 46,
            ],
        ] as $row) {
            Doctor::updateOrCreate(['id' => $row['id']], $row);
        }
    }

    /**
     * `synonyms` is what the visitor is likely to actually type. It feeds both
     * the Hermes prompt and the deterministic keyword matcher that stands in
     * when the provider is unreachable.
     *
     * `recovery_profile` is what the visitor's body will be up to afterwards.
     * It filters the "while you're there" suggestions and nothing else — it
     * never touches pricing, the bundle or the gate. Suggesting a beach day to
     * someone two days past cataract surgery, or chilli crab to someone whose
     * gastroscopy was this morning, is the kind of small wrongness that tells a
     * patient the system is not really paying attention.
     */
    private function procedures(): void
    {
        foreach ([
            [
                'id' => '0d9b53e7-4c16-42a8-9f70-6b3e18d5a29c',
                'code' => 'DEN-IMP-01',
                'name' => 'Dental Implant (single tooth, incl. crown)',
                'category' => 'DENTAL',
                'description' => 'Titanium implant fixture, abutment and porcelain-fused-to-zirconia crown. Includes CBCT scan and two follow-up visits.',
                'sg_benchmark_sgd' => 4800, 'batam_price_sgd' => 1450,
                'treatment_days' => 2, 'recovery_nights' => 1, 'requires_doctor_review' => false,
                'synonyms' => ['dental implant', 'implant', 'tooth implant', 'missing tooth', 'crown', 'dentist', 'teeth'],
                'recovery_profile' => [
                    'avoid_categories' => [],
                    'avoid_tags' => ['spicy', 'crunchy', 'alcohol'],
                    'prefer_tags' => ['soft-diet', 'quiet'],
                    'note' => 'Soft, cool food for the first two days — nothing crunchy, spicy or alcoholic on that side.',
                ],
            ],
            [
                'id' => '5f18a6c2-70d4-4931-bc0e-9a27f4e63b18',
                'code' => 'SCR-EXE-01',
                'name' => 'Executive Health Screening (comprehensive)',
                'category' => 'SCREENING',
                'description' => 'Full blood panel, tumour markers, ECG, chest X-ray, abdominal ultrasound, and same-day physician consultation.',
                'sg_benchmark_sgd' => 1250, 'batam_price_sgd' => 320,
                'treatment_days' => 1, 'recovery_nights' => 0, 'requires_doctor_review' => false,
                'synonyms' => ['health screening', 'medical check', 'checkup', 'check up', 'blood test', 'full body', 'medical checkup'],
                // Nothing is restricted afterwards. The constraint is before.
                'recovery_profile' => [
                    'avoid_categories' => [],
                    'avoid_tags' => [],
                    'prefer_tags' => [],
                    'note' => 'You fast before the blood panel, so plan anything involving food for after your appointment.',
                ],
            ],
            [
                'id' => 'b6432ed9-18a5-4c70-93f6-0e51d8b7a42c',
                'code' => 'OPH-LSK-01',
                'name' => 'LASIK Refractive Surgery (both eyes)',
                'category' => 'OPHTHALMOLOGY',
                'description' => 'Femtosecond bladeless LASIK for both eyes including pre-op topography, medication pack and 1-week review.',
                'sg_benchmark_sgd' => 3800, 'batam_price_sgd' => 1480,
                'treatment_days' => 1, 'recovery_nights' => 1, 'requires_doctor_review' => true,
                'synonyms' => ['lasik', 'laser eye', 'eye surgery', 'short sighted', 'myopia', 'glasses', 'vision correction'],
                'recovery_profile' => [
                    'avoid_categories' => ['BEACH'],
                    'avoid_tags' => ['sun-exposed', 'dusty', 'strenuous', 'crowded'],
                    'prefer_tags' => ['indoor', 'air-conditioned', 'quiet'],
                    'note' => 'No swimming, sun or dust for the first week, and bright light will be uncomfortable for a few days.',
                ],
            ],
            [
                'id' => '39c07f5b-6e21-4a8d-b054-7f92c31e6d80',
                'code' => 'OPH-CAT-01',
                'name' => 'Cataract Surgery (per eye, phaco + IOL)',
                'category' => 'OPHTHALMOLOGY',
                'description' => 'Phacoemulsification with monofocal intraocular lens implant, day-surgery theatre and post-op medication.',
                'sg_benchmark_sgd' => 5400, 'batam_price_sgd' => 1850,
                'treatment_days' => 1, 'recovery_nights' => 2, 'requires_doctor_review' => true,
                'synonyms' => ['cataract', 'cloudy vision', 'lens replacement', 'iol'],
                'recovery_profile' => [
                    'avoid_categories' => ['BEACH'],
                    'avoid_tags' => ['sun-exposed', 'dusty', 'strenuous', 'crowded', 'stairs'],
                    'prefer_tags' => ['indoor', 'air-conditioned', 'quiet', 'step-free'],
                    'note' => 'Keep water, sand and dust out of the eye, avoid bending and lifting, and wear the shield you are given.',
                ],
            ],
            [
                'id' => 'e850d16f-2b93-4708-a5c1-4d68b09f7e23',
                'code' => 'ORT-KNE-01',
                'name' => 'Knee Arthroscopy (meniscus repair)',
                'category' => 'ORTHOPEDICS',
                'description' => 'Diagnostic and therapeutic arthroscopy with meniscal repair, spinal anaesthesia, one inpatient night and physiotherapy briefing.',
                'sg_benchmark_sgd' => 12500, 'batam_price_sgd' => 4200,
                'treatment_days' => 2, 'recovery_nights' => 3, 'requires_doctor_review' => true,
                'synonyms' => ['knee', 'meniscus', 'arthroscopy', 'knee surgery', 'acl', 'cartilage'],
                'recovery_profile' => [
                    'avoid_categories' => ['BEACH'],
                    'avoid_tags' => ['strenuous', 'stairs', 'sun-exposed', 'crowded'],
                    'prefer_tags' => ['step-free', 'wheelchair-accessible', 'indoor', 'quiet'],
                    'note' => 'You will be on crutches. Sand, stairs and long walks are out for this trip.',
                ],
            ],
            [
                'id' => '7a21c48e-0f36-4d95-8b62-1e94a5c7038d',
                'code' => 'GEN-ENDO-01',
                'name' => 'Gastroscopy + Colonoscopy Package',
                'category' => 'GENERAL_SURGERY',
                'description' => 'Dual endoscopy under sedation with biopsy if indicated, histopathology and specialist report within 72 hours.',
                'sg_benchmark_sgd' => 2400, 'batam_price_sgd' => 780,
                'treatment_days' => 1, 'recovery_nights' => 1, 'requires_doctor_review' => false,
                'synonyms' => ['endoscopy', 'gastroscopy', 'colonoscopy', 'scope', 'stomach', 'gastric'],
                'recovery_profile' => [
                    'avoid_categories' => [],
                    'avoid_tags' => ['spicy', 'alcohol', 'crunchy', 'strenuous'],
                    'prefer_tags' => ['soft-diet', 'quiet', 'air-conditioned'],
                    'note' => 'Light, bland food for 24 hours after the sedation — no chilli, no alcohol, and someone with you.',
                ],
            ],
        ] as $row) {
            Procedure::updateOrCreate(['id' => $row['id']], $row);
        }
    }

    private function ferryRoutes(): void
    {
        foreach ([
            ['id' => 'c2e60849-7b13-4a5f-90d8-6e34b17c9f25', 'operator' => 'Batam Fast Ferry', 'direction' => 'SG_TO_BATAM', 'depart_terminal' => 'HarbourFront Centre, Singapore', 'arrive_terminal' => 'Batam Centre Ferry Terminal', 'departure_time' => '08:00', 'arrival_time' => '09:00', 'duration_minutes' => 60, 'price_sgd' => 29],
            ['id' => '4d871ba6-3e09-42c7-b51f-8a0e69d3c247', 'operator' => 'Sindo Ferry', 'direction' => 'SG_TO_BATAM', 'depart_terminal' => 'HarbourFront Centre, Singapore', 'arrive_terminal' => 'Sekupang Ferry Terminal', 'departure_time' => '08:40', 'arrival_time' => '09:30', 'duration_minutes' => 50, 'price_sgd' => 31],
            ['id' => '86f30d2c-591a-4e73-8206-b7d4a15fe609', 'operator' => 'Majestic Fast Ferry', 'direction' => 'SG_TO_BATAM', 'depart_terminal' => 'HarbourFront Centre, Singapore', 'arrive_terminal' => 'Batam Centre Ferry Terminal', 'departure_time' => '10:20', 'arrival_time' => '11:20', 'duration_minutes' => 60, 'price_sgd' => 27],
            ['id' => '2b95e714-6c80-4f3a-9d17-05e8c26ba49f', 'operator' => 'Batam Fast Ferry', 'direction' => 'BATAM_TO_SG', 'depart_terminal' => 'Batam Centre Ferry Terminal', 'arrive_terminal' => 'HarbourFront Centre, Singapore', 'departure_time' => '17:30', 'arrival_time' => '18:30', 'duration_minutes' => 60, 'price_sgd' => 29],
            ['id' => 'fa03c86d-1e57-4920-b8c4-73a06d1f5e82', 'operator' => 'Sindo Ferry', 'direction' => 'BATAM_TO_SG', 'depart_terminal' => 'Sekupang Ferry Terminal', 'arrive_terminal' => 'HarbourFront Centre, Singapore', 'departure_time' => '16:00', 'arrival_time' => '16:50', 'duration_minutes' => 50, 'price_sgd' => 31],
            ['id' => '15c7e903-8d42-4b61-a07f-9c25e83b6d04', 'operator' => 'Horizon Fast Ferry', 'direction' => 'BATAM_TO_SG', 'depart_terminal' => 'Batam Centre Ferry Terminal', 'arrive_terminal' => 'HarbourFront Centre, Singapore', 'departure_time' => '19:00', 'arrival_time' => '20:00', 'duration_minutes' => 60, 'price_sgd' => 33],
        ] as $row) {
            FerryRoute::updateOrCreate(['id' => $row['id']], $row);
        }
    }

    /**
     * Recovery hotels.
     *
     * No distance column, by design. These four sit in four different parts of
     * the island, and how far each one is from "the hospital" depends entirely
     * on which of the three hospitals the patient chose — Sekupang is a 12 km
     * drive from Batam Centre. BundleBuilder computes it against their actual
     * choice; see docs/09 D21.
     */
    /**
     * Four real Batam hotels, at their real coordinates.
     *
     * These were the most damaging rows in the old seed. The businesses were
     * genuine, so nothing looked wrong — but Best Western Panbil was placed
     * 5.7 km from where it actually is, Radisson 0.9 km, Nagoya Hill 0.6 km.
     * The haversine was correct and the answers were fiction, which is the
     * worst failure mode available: confidently precise and wrong.
     *
     * Rates, amenities and the recovery certification are still fixtures. The
     * identity and the position are not.
     */
    private function hotels(): void
    {
        foreach ([
            ['id' => '6e40b18f-2c75-4a93-80d6-5b17e9c04af2', 'name' => 'HARRIS Hotel Batam Center', 'district' => 'Batam Kota', 'star_rating' => 4, 'nightly_rate_sgd' => 62, 'latitude' => 1.130514, 'longitude' => 104.054035, 'osm_ref' => 'node/5526812905', 'amenities' => ['Soft-diet room service', 'Ferry terminal shuttle', 'Lift access', 'Wi-Fi'], 'medical_recovery_certified' => true],
            ['id' => 'd38c05a7-9f61-42be-b74c-08e35d1a9762', 'name' => 'Radisson Golf & Convention Center Batam', 'district' => 'Batam Kota', 'star_rating' => 5, 'nightly_rate_sgd' => 84, 'latitude' => 1.103554, 'longitude' => 104.031796, 'osm_ref' => 'way/575205306', 'amenities' => ['24h in-room dining', 'Wheelchair-accessible rooms', 'On-call nurse', 'Wi-Fi'], 'medical_recovery_certified' => true],
            ['id' => '0b7f24e5-6a38-4d19-9c05-e2416b8fa73d', 'name' => 'Nagoya Hill Hotel Batam', 'district' => 'Nagoya', 'star_rating' => 3, 'nightly_rate_sgd' => 41, 'latitude' => 1.147532, 'longitude' => 104.012855, 'osm_ref' => 'way/616123913', 'amenities' => ['Mall access', 'Late check-out', 'Wi-Fi'], 'medical_recovery_certified' => false],
            ['id' => '9c1e805b-4d72-46af-83e1-7a069c5b21ed', 'name' => 'Best Western Premier Panbil', 'district' => 'Muka Kuning', 'star_rating' => 4, 'nightly_rate_sgd' => 58, 'latitude' => 1.082349, 'longitude' => 104.030035, 'osm_ref' => 'way/543028102', 'amenities' => ['Quiet recovery wing', 'Soft-diet menu', 'Lift access', 'Wi-Fi'], 'medical_recovery_certified' => true],
        ] as $row) {
            Hotel::updateOrCreate(['id' => $row['id']], $row);
        }
    }

    /**
     * Somewhere to eat, walk or look at between appointments.
     *
     * EVERY ROW HERE EXISTS. Each carries the OpenStreetMap element it was
     * taken from, and `assertVerified()` refuses to finish the seed if one does
     * not. The previous version of this method did not have that check and
     * contained at least four businesses that were never real.
     *
     * NONE OF IT IS PRICED. There is no `price_sgd` here and there never will
     * be: places are suggestions, not quote lines, so they cannot enter the
     * bundle, the total, or the Singapore savings comparison (docs/09 D9, D22).
     * `price_level` is a guidebook band — the same thing a review site means by
     * "$$" — and it is rendered as one.
     *
     * `tags` is the vocabulary the recovery filter matches on, and it is the
     * one field here that is still editorial judgement rather than OSM data:
     * `soft-diet` is why a congee shop is the first thing a dental implant
     * patient sees, and `sun-exposed` is why a cataract patient is never shown
     * a beach. Where OSM had a `diet:*` or `cuisine` tag it was used; the rest
     * is inference from what the place is, and it is inference about the venue,
     * never about the patient.
     *
     * There is no FESTIVAL row. The category is supported, but nothing seasonal
     * could be verified, and an unverifiable festival is exactly the kind of
     * row this file just spent a rewrite removing.
     */
    private function places(): void
    {
        foreach ([
            /* ---- Eating ----------------------------------------------------
             *
             * These are the places Batam is actually known for, taken from
             * published guides rather than from anyone's imagination — EatBook's
             * Batam food guide and BatamFast's seafood round-up — and then
             * matched to an OpenStreetMap element for the coordinate.
             *
             * Two sources, doing two different jobs: `guide_url` says a real
             * publication thinks the place is worth eating at, `osm_ref` says
             * where it is. A row with both is as grounded as this catalogue
             * gets. The previous restaurant list had neither.
             */
            [
                'id' => 'c58d1930-2a7f-4b64-90e8-73c15a6f2d09',
                'name' => 'Sup Ikan Yong Kee', 'category' => 'RESTAURANT', 'district' => 'Batam Kota',
                'description' => 'Sliced fish soup, and prawn and squid soup, in clear broth. The Batam staple, and the easiest thing to eat when chewing is uncomfortable.',
                'latitude' => 1.128350, 'longitude' => 104.050330, 'price_level' => 2,
                'osm_ref' => 'node/857038137',
                'guide_url' => 'https://eatbook.sg/batam-food-guide/',
                'tags' => ['soft-diet', 'halal', 'indoor', 'english-spoken'],
            ],
            [
                'id' => '1f4a7c62-83d0-4e19-9a25-6b70c4d81e35',
                'name' => 'Golden Prawn 933', 'category' => 'RESTAURANT', 'district' => 'Bengkong',
                'description' => "Batam's oldest and best-known seafood restaurant, built out over the water at Bengkong Laut. Chilli crab, butter prawns, steamed fish.",
                'latitude' => 1.160300, 'longitude' => 104.037180, 'price_level' => 3,
                'osm_ref' => 'node/903121912',
                'guide_url' => 'https://blog.batamfast.com/batam-seafood-restaurant/',
                'tags' => ['halal', 'spicy', 'crunchy', 'family-friendly', 'crowded', 'outdoor'],
            ],
            [
                'id' => '7b2e05d1-c964-4a37-8f61-25d0e93b7a48',
                'name' => 'Harbour Bay Seafood Restaurant', 'category' => 'RESTAURANT', 'district' => 'Jodoh',
                'description' => 'Salted egg crab and black pepper crayfish, a few minutes from the Harbour Bay ferry terminal.',
                'latitude' => 1.154640, 'longitude' => 103.996276, 'price_level' => 3,
                'osm_ref' => 'node/4599681496',
                'guide_url' => 'https://eatbook.sg/batam-food-guide/',
                'tags' => ['halal', 'spicy', 'crunchy', 'family-friendly', 'crowded'],
            ],
            [
                'id' => '9d07c4e8-5b26-4f13-8206-c4a71e5d93b0',
                'name' => 'Wey Wey Seafood', 'category' => 'RESTAURANT', 'district' => 'Jodoh',
                'description' => 'Long-running local seafood house near Harbour Bay, regularly named in Batam eating guides.',
                'latitude' => 1.152530, 'longitude' => 103.998040, 'price_level' => 2,
                'osm_ref' => 'node/703813205',
                'guide_url' => 'https://blog.batamfast.com/batam-seafood-restaurant/',
                'tags' => ['halal', 'spicy', 'crunchy', 'crowded'],
            ],
            [
                'id' => '42e9b7a5-6013-4d8c-a75f-90b2e34c1867',
                'name' => "Mie Terempa'k Batam Center", 'category' => 'RESTAURANT', 'district' => 'Batam Kota',
                'description' => 'Mie tarempa — the Riau Islands noodle dish — with beef or seafood. Quick, cheap, and close to the terminal.',
                'latitude' => 1.115193, 'longitude' => 104.054084, 'price_level' => 1,
                'osm_ref' => 'node/4599681392',
                'guide_url' => 'https://eatbook.sg/batam-food-guide/',
                'tags' => ['halal', 'spicy', 'indoor'],
            ],
            [
                'id' => '3e61d20f-9a48-4c75-b1d9-04f8267ae53c',
                'name' => 'Bubur Jakarta', 'category' => 'RESTAURANT', 'district' => 'Nagoya',
                'description' => 'Rice porridge and congee, plain or with chicken. The obvious first meal when chewing is off the table.',
                'latitude' => 1.143372, 'longitude' => 104.011463, 'price_level' => 1,
                'osm_ref' => 'node/736609690',
                'tags' => ['soft-diet', 'quiet', 'indoor', 'step-free'],
            ],
            [
                'id' => '8a4c7e30-1d59-4b86-92f0-6c53d18b0a74',
                'name' => 'Moon', 'category' => 'RESTAURANT', 'district' => 'Nagoya',
                'description' => 'Indonesian-Chinese cooking, entirely meat-free — tagged vegetarian-only in OpenStreetMap.',
                'latitude' => 1.146380, 'longitude' => 104.008540, 'price_level' => 1,
                'osm_ref' => 'node/736621124',
                'tags' => ['vegetarian', 'soft-diet', 'quiet', 'indoor', 'air-conditioned'],
            ],
            [
                'id' => '05b93c7e-4f81-4a20-8d6b-19e7c25f40a3',
                'name' => 'Gado-Gado Gembira', 'category' => 'RESTAURANT', 'district' => 'Nagoya',
                'description' => 'Blanched vegetables and peanut sauce, done properly. Meat-free by construction.',
                'latitude' => 1.146380, 'longitude' => 104.009070, 'price_level' => 1,
                'osm_ref' => 'node/736621123',
                'tags' => ['vegetarian', 'halal', 'indoor', 'quiet'],
            ],
            [
                'id' => 'b7130e59-8c24-4f06-a93d-52681ce74b0f',
                'name' => 'RM Padang Sederhana', 'category' => 'RESTAURANT', 'district' => 'Nagoya',
                'description' => 'Padang rice with a dozen dishes brought to the table. Generous, fast, and hot in every sense.',
                'latitude' => 1.141980, 'longitude' => 104.012350, 'price_level' => 1,
                'osm_ref' => 'node/736610278',
                'tags' => ['halal', 'spicy', 'indoor'],
            ],

            /* ---- Malls — level, air-conditioned, and where a recovering patient
                   actually ends up ------------------------------------------- */
            [
                'id' => '6c2f81d4-70a3-4e59-b846-0d19f37c25ea',
                'name' => 'Nagoya Hill Shopping Centre', 'category' => 'MALL', 'district' => 'Nagoya',
                'description' => "Batam's largest mall: pharmacy, supermarket, food court and cinema under one roof.",
                'latitude' => 1.146271, 'longitude' => 104.012614, 'price_level' => 2,
                'osm_ref' => 'way/59398752',
                'tags' => ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'family-friendly', 'crowded'],
            ],
            [
                'id' => 'e40b7592-13c8-4d6a-95f7-8b02e61ac934',
                'name' => 'Kepri Mall', 'category' => 'MALL', 'district' => 'Batam Kota',
                'description' => 'Everyday mall on the Batam Kota side — groceries, a food hall, and lifts to every floor.',
                'latitude' => 1.100859, 'longitude' => 104.036697, 'price_level' => 2,
                'osm_ref' => 'way/577003448',
                'tags' => ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'family-friendly'],
            ],
            [
                'id' => '24d80f16-5e93-4b7c-8a01-c67d3f95e2b8',
                'name' => 'Mega Mall Batam Centre', 'category' => 'MALL', 'district' => 'Batam Kota',
                'description' => 'Beside the Batam Centre ferry terminal — the obvious place to wait out a few hours before a crossing.',
                'latitude' => 1.129240, 'longitude' => 104.055977, 'price_level' => 2,
                'osm_ref' => 'way/606276855',
                'tags' => ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'crowded'],
            ],
            [
                'id' => 'f169c50e-7b34-4a82-9d6f-3081b57ce24a',
                'name' => 'Panbil Mall', 'category' => 'MALL', 'district' => 'Muka Kuning',
                'description' => 'Quiet mall in the Panbil estate, a short walk from the hotel of the same name.',
                'latitude' => 1.072100, 'longitude' => 104.023548, 'price_level' => 2,
                'osm_ref' => 'way/599509067',
                'tags' => ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'quiet'],
            ],
            [
                'id' => '5a72e0d3-6f19-4c48-b25e-90c7d146a8f3',
                'name' => 'Grand Batam Mall', 'category' => 'MALL', 'district' => 'Baloi',
                'description' => 'Smaller Baloi mall with a supermarket and a pharmacy, close to the hospitals on Gajah Mada.',
                'latitude' => 1.135339, 'longitude' => 104.007797, 'price_level' => 2,
                'osm_ref' => 'node/9355230187',
                'tags' => ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free', 'quiet'],
            ],
            [
                'id' => '0e58b3a7-2d61-4790-8c34-b7e1520fd69c',
                'name' => 'Harbour Bay Mall', 'category' => 'MALL', 'district' => 'Jodoh',
                'description' => 'Waterfront mall attached to the Harbour Bay ferry terminal, with a duty-free hall.',
                'latitude' => 1.154253, 'longitude' => 104.001147, 'price_level' => 2,
                'osm_ref' => 'way/253921747',
                'tags' => ['indoor', 'air-conditioned', 'wheelchair-accessible', 'step-free'],
            ],

            /* ---- Beaches — filtered out after eye and joint surgery --------- */
            [
                'id' => 'a3c17e05-9482-4b31-96da-7f0523c8e14b',
                'name' => 'Nongsa Beach', 'category' => 'BEACH', 'district' => 'Nongsa',
                'description' => 'The calm north-east stretch facing Singapore, with resort day passes and a flat walk along the sand.',
                'latitude' => 1.194678, 'longitude' => 104.088963, 'price_level' => 1,
                'osm_ref' => 'way/482249158',
                'tags' => ['outdoor', 'sun-exposed', 'family-friendly', 'strenuous'],
            ],
            [
                'id' => '7ec40b18-3d95-4620-a8f7-14b06e93c25d',
                'name' => 'Marina Waterfront, Sekupang', 'category' => 'BEACH', 'district' => 'Sekupang',
                'description' => 'West-coast waterfront with a promenade and sunset views back towards the mainland.',
                'latitude' => 1.082990, 'longitude' => 103.932388, 'price_level' => 1,
                'osm_ref' => 'node/702331547',
                'tags' => ['outdoor', 'sun-exposed', 'family-friendly'],
            ],

            /* ---- Parks ----------------------------------------------------- */
            [
                'id' => '91f6a2c7-08e5-4d34-b7a9-6c25e10f8b43',
                'name' => 'Kebun Raya Batam', 'category' => 'PARK', 'district' => 'Nongsa',
                'description' => "Batam's botanical garden — shaded trails and planted collections across a large hillside site.",
                'latitude' => 1.170080, 'longitude' => 104.081571, 'price_level' => 1,
                'osm_ref' => 'way/566675315',
                'tags' => ['outdoor', 'quiet', 'sun-exposed', 'strenuous'],
            ],
            [
                'id' => '4b0d9e63-a527-4f18-89c1-3e76b02d514f',
                'name' => 'Hutan Wisata Mata Kucing', 'category' => 'PARK', 'district' => 'Sei Ladi',
                'description' => 'Recreational forest park with walking paths under mature trees, minutes from the city.',
                'latitude' => 1.085136, 'longitude' => 103.971603, 'price_level' => 1,
                'osm_ref' => 'node/700645205',
                'tags' => ['outdoor', 'quiet', 'strenuous', 'family-friendly'],
            ],
            [
                'id' => 'cf3820a5-6e14-4b97-a052-8d139c67e40b',
                'name' => 'Ocarina Park', 'category' => 'PARK', 'district' => 'Batam Kota',
                'description' => 'Seafront park by Batam Centre with a Ferris wheel, paved paths and food stalls along the water.',
                'latitude' => 1.151960, 'longitude' => 104.054710, 'price_level' => 1,
                'osm_ref' => 'node/703856231',
                'tags' => ['outdoor', 'sun-exposed', 'family-friendly', 'step-free', 'crowded'],
            ],

            /* ---- Attractions ----------------------------------------------- */
            [
                'id' => '62a5d70c-1f89-4e35-b6c8-04729ad3f156',
                'name' => 'Vihara Duta Maitreya', 'category' => 'ATTRACTION', 'district' => 'Sungai Panas',
                'description' => 'One of the largest Buddhist temple complexes in the region. Calm, level throughout, and free to enter.',
                'latitude' => 1.129439, 'longitude' => 104.034725, 'price_level' => 0,
                'osm_ref' => 'node/6865933721',
                'tags' => ['indoor', 'quiet', 'step-free', 'wheelchair-accessible'],
            ],
            [
                'id' => '2d61f047-8b93-4c15-a70e-63f8b104d259',
                'name' => 'Batam Cable Ski', 'category' => 'ATTRACTION', 'district' => 'Sekupang',
                'description' => 'Cable wakeboarding park on the west coast lagoon. Worth watching even if you are not going in.',
                'latitude' => 1.080273, 'longitude' => 103.937805, 'price_level' => 2,
                'osm_ref' => 'node/624950721',
                'tags' => ['outdoor', 'sun-exposed', 'strenuous', 'family-friendly'],
            ],
        ] as $row) {
            Place::updateOrCreate(['id' => $row['id']], $row);
        }
    }

    private function groundTransport(): void
    {
        foreach ([
            ['id' => '3a86d0f4-15c9-4e27-b6a8-0d94f7e35c61', 'type' => 'PRIVATE_CAR', 'provider' => 'MedBridge Care Fleet', 'description' => 'Private air-conditioned sedan with English-speaking driver. Terminal pick-up, hospital and hotel transfers, return drop-off.', 'price_sgd' => 48, 'capacity' => 3],
            ['id' => '7d29e5b1-08a6-4c34-95f7-b21e60d84a39', 'type' => 'WHEELCHAIR_VAN', 'provider' => 'MedBridge Care Fleet', 'description' => 'Wheelchair-accessible van with ramp and trained assistant for reduced-mobility patients.', 'price_sgd' => 76, 'capacity' => 4],
            ['id' => 'e04b736a-5d18-49f2-8c60-1b73a95e20d4', 'type' => 'SHUTTLE', 'provider' => 'Hospital Partner Shuttle', 'description' => 'Shared scheduled shuttle between the ferry terminal and the partner hospital. Departs hourly.', 'price_sgd' => 18, 'capacity' => 12],
            ['id' => '58f13c9e-7204-4a86-b0d5-9e62c14f8b37', 'type' => 'AMBULANCE', 'provider' => 'Batam Emergency Medical Services', 'description' => 'Basic life-support ambulance with paramedic escort for post-operative or stretcher-bound transfers.', 'price_sgd' => 165, 'capacity' => 1],
        ] as $row) {
            GroundTransport::updateOrCreate(['id' => $row['id']], $row);
        }
    }
}
