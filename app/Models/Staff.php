<?php

namespace App\Models;

use App\Models\Concerns\HasUuidV4;
use Illuminate\Database\Eloquent\Model;

class Staff extends Model
{
    use HasUuidV4;

    protected $table = 'staff';

    protected $guarded = [];
}
