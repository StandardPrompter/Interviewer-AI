/**
 * POST /api/sonic – Open an SSE session with Nova 2 Sonic.
 * GET  /api/sonic – Health check.
 *
 * Body (JSON): { systemPrompt?: string, sessionId: string }
 * Response: text/event-stream (SSE)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { randomUUID } from "node:crypto";
import {
  type SessionState,
  setSession,
  deleteSession,
  sessionCount,
  sessionStartEvent,
  promptStartEvent,
  textContentStartEvent,
  textInputEvent,
  contentEndEvent,
  audioContentStartEvent,
} from "@/lib/sonic-session";

const MODEL_ID = "amazon.nova-2-sonic-v1:0";
const REGION = process.env.AWS_REGION || "us-east-1";

function createBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      ...(process.env.AWS_SESSION_TOKEN && {
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }),
    },
    requestHandler: new NodeHttp2Handler({
      requestTimeout: 300_000,
      sessionTimeout: 300_000,
    }),
  });
}

// ── POST /api/sonic ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const systemPrompt: string =
    body.systemPrompt ??
    "You are a professional technical interviewer. Ask one clear question at a time and listen carefully to the candidate.";
  const sessionId: string = body.sessionId ?? randomUUID();

  const bedrockClient = createBedrockClient();
  const promptName = randomUUID();
  const systemContentName = randomUUID();
  const audioContentName = randomUUID();

  const session: SessionState = {
    promptName,
    audioContentName,
    queue: [],
    resolve: null,
    closed: false,
  };
  setSession(sessionId, session);

  async function* inputStream() {
    yield sessionStartEvent();
    yield promptStartEvent(promptName);

    yield textContentStartEvent(promptName, systemContentName, "SYSTEM");
    yield textInputEvent(promptName, systemContentName, systemPrompt);
    yield contentEndEvent(promptName, systemContentName);

    yield audioContentStartEvent(promptName, audioContentName);

    while (!session.closed) {
      if (session.queue.length > 0) {
        yield session.queue.shift()!;
      } else {
        await new Promise<void>((resolve) => {
          session.resolve = resolve;
        });
      }
    }

    while (session.queue.length > 0) {
      yield session.queue.shift()!;
    }
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  function sseWrite(data: object) {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {});
  }

  (async () => {
    try {
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: MODEL_ID,
        body: inputStream(),
      });

      const response = await bedrockClient.send(command);

      for await (const event of response.body ?? []) {
        if (event.chunk?.bytes) {
          try {
            const text = new TextDecoder().decode(event.chunk.bytes);
            const json = JSON.parse(text);
            const e = json.event ?? {};

            if (e.contentStart) {
              sseWrite({ type: "contentStart", role: e.contentStart.role ?? "", contentType: e.contentStart.type ?? "" });
            } else if (e.textOutput) {
              sseWrite({ type: "text", role: e.textOutput.role ?? "ASSISTANT", content: e.textOutput.content ?? "" });
            } else if (e.audioOutput) {
              sseWrite({ type: "audio", content: e.audioOutput.content ?? "" });
            } else if (e.toolUse) {
              sseWrite({ type: "toolUse", toolName: e.toolUse.toolName });
            } else if (e.contentEnd) {
              sseWrite({ type: "contentEnd", contentType: e.contentEnd.type ?? "", stopReason: e.contentEnd.stopReason ?? "" });
            } else if (e.promptEnd) {
              sseWrite({ type: "promptEnd" });
            } else if (e.completionEnd) {
              sseWrite({ type: "completionEnd" });
            }
          } catch {
            // Non-JSON chunk
          }
        } else if (event.modelStreamErrorException) {
          sseWrite({ type: "error", message: event.modelStreamErrorException.message ?? "Model stream error" });
        } else if (event.internalServerException) {
          sseWrite({ type: "error", message: "Internal server error from Bedrock" });
        }
      }

      sseWrite({ type: "done" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Nova 2 Sonic stream error:", err);
      sseWrite({ type: "error", message });
    } finally {
      deleteSession(sessionId);
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Session-Id": sessionId,
    },
  });
}

// ── GET /api/sonic ───────────────────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    status: "ok",
    model: MODEL_ID,
    region: REGION,
    activeSessions: sessionCount(),
  });
}
