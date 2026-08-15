<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seeds the reference catalogue only.
     *
     * There are deliberately no seeded patients or inquiries: those arrive from
     * real conversations through the web chat. An empty pipeline on a fresh
     * install is correct — the dashboard should show what people actually
     * submitted, not fixtures pretending to be traffic.
     */
    public function run(): void
    {
        $this->call(CatalogueSeeder::class);
    }
}
