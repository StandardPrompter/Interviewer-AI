/**
 * POST   /api/sonic/audio – Push an audio chunk into an active Bedrock session.
 * DELETE /api/sonic/audio – Signal end of audio / session teardown.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  deleteSession,
  audioInputEvent,
  contentEndEvent,
  promptEndEvent,
  sessionEndEvent,
} from "@/lib/sonic-session";

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, audio } = body as { sessionId: string; audio: string };

    if (!sessionId || !audio) {
      return NextResponse.json({ error: "sessionId and audio (base64) are required" }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.closed) {
      return NextResponse.json({ error: "Session is closed" }, { status: 410 });
    }

    session.queue.push(audioInputEvent(session.promptName, session.audioContentName, audio));

    if (session.resolve) {
      const r = session.resolve;
      session.resolve = null;
      r();
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("POST /api/sonic/audio error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId } = body as { sessionId: string };

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ ok: true, note: "Session already gone" });
    }

    session.queue.push(
      contentEndEvent(session.promptName, session.audioContentName),
      promptEndEvent(session.promptName),
      sessionEndEvent(),
    );
    session.closed = true;

    if (session.resolve) {
      const r = session.resolve;
      session.resolve = null;
      r();
    }

    deleteSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("DELETE /api/sonic/audio error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
