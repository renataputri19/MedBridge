<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityEvent;
use App\Models\Message;
use App\Models\MessageThread;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageController extends Controller
{
    public function threads(): JsonResponse
    {
        return response()->json(
            MessageThread::with('messages', 'patient')
                ->orderByDesc('last_message_at')
                ->get()->map->toApi()->values()
        );
    }

    /**
     * POST /messages/threads/{id}/send
     *
     * `body` is always the HUMAN-REVIEWED text. This handler takes a body and
     * nothing else — it is structurally incapable of reading `ai_suggestion`,
     * which is the point. An AI draft is something a person edits or discards,
     * never something the system dispatches on its own.
     */
    public function send(Request $request, string $threadId): JsonResponse
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'min:1', 'max:4000'],
            'senderName' => ['required', 'string', 'min:2', 'max:120'],
        ]);

        $thread = MessageThread::whereKey($threadId)->firstOr(fn () => abort(404, 'Thread not found.'));

        $message = Message::create([
            'thread_id' => $thread->id,
            'inquiry_id' => $thread->inquiry_id,
            'channel' => $thread->channel,
            'direction' => 'OUTBOUND',
            'body' => $data['body'],
            'sender_name' => $data['senderName'],
            'status' => 'SENT',
        ]);

        $thread->update(['last_message_at' => now(), 'unread_count' => 0]);

        ActivityEvent::record(
            'MESSAGE_SENT', 'STAFF',
            'Reply sent by '.$data['senderName'],
            'A staff member sent a reviewed message to the patient.',
            ['thread_id' => $thread->id, 'channel' => $thread->channel, 'length' => mb_strlen($data['body'])],
            $thread->inquiry_id ? $thread->inquiry : null,
        );

        return response()->json($message->toApi(), 201);
    }

    public function markRead(string $threadId): JsonResponse
    {
        MessageThread::whereKey($threadId)->update(['unread_count' => 0]);

        return response()->json(null, 204);
    }
}
