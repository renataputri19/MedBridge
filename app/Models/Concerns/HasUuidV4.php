<?php

namespace App\Models\Concerns;

use Illuminate\Support\Str;

/**
 * Assigns a strict RFC-4122 v4 UUID as the primary key.
 *
 * Deliberately NOT Laravel's built-in HasUuids trait: that uses
 * Str::orderedUuid(), a timestamp-first COMB value. Every key in this system is
 * a plain v4 (docs/01 rule 2), and the smoke suite asserts it against a strict
 * v4 regex — so the key generator has to be Str::uuid().
 */
trait HasUuidV4
{
    public static function bootHasUuidV4(): void
    {
        static::creating(function ($model) {
            if (empty($model->{$model->getKeyName()})) {
                $model->{$model->getKeyName()} = (string) Str::uuid();
            }
        });
    }

    public function getIncrementing(): bool
    {
        return false;
    }

    public function getKeyType(): string
    {
        return 'string';
    }
}
