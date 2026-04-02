/**
 * Amazon Nova 2 Sonic - WebSocket/SSE Bridge Route (Next.js)
 * ===========================================================
 * Model: amazon.nova-2-sonic-v1:0
 *
 * ARCHITECTURE NOTE:
 * Nova 2 Sonic requires a long-lived HTTP/2 bidirectional stream. This CANNOT
 * be correctly served from a short-lived Next.js API route in a stateless way.
 *
 * This file provides a SESSION MANAGEMENT endpoint that:
 *   POST /api/sonic  → creates a new Bedrock streaming session, initialises it
 *                      with the system prompt, and streams events back to the
 *                      client via Server-Sent Events (SSE).
 *
 * The client sends audio chunks via separate POST /api/sonic/audio calls while
 * the SSE connection is open.
 *
 * For production, use a standalone WebSocket server (see websocket-nodejs sample).
 *
 * Required packages:
 *   npm install @aws-sdk/client-bedrock-runtime @smithy/node-http-handler
 */

import { NextRequest, NextResponse } from "next/server";
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttp2Handler } from "@smithy/node-http-handler";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_ID = "amazon.nova-2-sonic-v1:0";
const REGION = process.env.AWS_REGION || "us-east-1";

// Audio settings that must match what the client sends
const AUDIO_INPUT_CONFIG = {
  mediaType: "audio/lpcm",
  sampleRateHertz: 16000,    // Client MUST record at 16kHz
  sampleSizeBits: 16,
  channelCount: 1,
  audioType: "SPEECH",
  encoding: "base64",
};

// Audio settings for Nova 2 Sonic's output
const AUDIO_OUTPUT_CONFIG = {
  mediaType: "audio/lpcm",
  sampleRateHertz: 24000,
  sampleSizeBits: 16,
  channelCount: 1,
  voiceId: "matthew",        // Options: matthew, tiffany, amy, etc.
  encoding: "base64",
  audioType: "SPEECH",
};

// ---------------------------------------------------------------------------
// Bedrock client — MUST use NodeHttp2Handler for bidirectional streaming
// ---------------------------------------------------------------------------

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
    // HTTP/2 is REQUIRED for bidirectional streaming
    requestHandler: new NodeHttp2Handler({
      requestTimeout: 300_000,
      sessionTimeout: 300_000,
    }),
  });
}

// ---------------------------------------------------------------------------
// Event builders — Nova 2 Sonic JSON event protocol
// ---------------------------------------------------------------------------

function encodeEvent(eventObj: object): { chunk: { bytes: Uint8Array } } {
  return {
    chunk: {
      bytes: new TextEncoder().encode(JSON.stringify(eventObj)),
    },
  };
}

function sessionStartEvent(maxTokens = 1024, topP = 0.9, temperature = 0.7) {
  return encodeEvent({
    event: {
      sessionStart: {
        inferenceConfiguration: { maxTokens, topP, temperature },
      },
    },
  });
}

function promptStartEvent(promptName: string, voiceId = "matthew") {
  return encodeEvent({
    event: {
      promptStart: {
        promptName,
        textOutputConfiguration: { mediaType: "text/plain" },
        audioOutputConfiguration: { ...AUDIO_OUTPUT_CONFIG, voiceId },
        toolUseOutputConfiguration: { mediaType: "application/json" },
        toolConfiguration: { tools: [] }, // Add tools here if needed
      },
    },
  });
}

function textContentStartEvent(
  promptName: string,
  contentName: string,
  role: "SYSTEM" | "USER" | "ASSISTANT" = "SYSTEM"
) {
  return encodeEvent({
    event: {
      contentStart: {
        promptName,
        contentName,
        type: "TEXT",
        interactive: false,
        role,
        textInputConfiguration: { mediaType: "text/plain" },
      },
    },
  });
}

function textInputEvent(promptName: string, contentName: string, content: string) {
  return encodeEvent({
    event: { textInput: { promptName, contentName, content } },
  });
}

function audioContentStartEvent(promptName: string, contentName: string) {
  return encodeEvent({
    event: {
      contentStart: {
        promptName,
        contentName,
        type: "AUDIO",
        interactive: true,
        role: "USER",
        audioInputConfiguration: AUDIO_INPUT_CONFIG,
      },
    },
  });
}

function audioInputEvent(promptName: string, contentName: string, base64Audio: string) {
  return encodeEvent({
    event: { audioInput: { promptName, contentName, content: base64Audio } },
  });
}

function contentEndEvent(promptName: string, contentName: string) {
  return encodeEvent({
    event: { contentEnd: { promptName, contentName } },
  });
}

function promptEndEvent(promptName: string) {
  return encodeEvent({ event: { promptEnd: { promptName } } });
}

function sessionEndEvent() {
  return encodeEvent({ event: { sessionEnd: {} } });
}

// ---------------------------------------------------------------------------
// POST /api/sonic — SSE streaming session
// ---------------------------------------------------------------------------
/**
 * Request body (JSON):
 * {
 *   systemPrompt?: string,
 *   sessionId?: string
 * }
 *
 * Response: text/event-stream (SSE)
 * Each SSE event is one of:
 *   { type: "text", role: "ASSISTANT"|"USER", content: string }
 *   { type: "audio", content: "<base64 PCM 24kHz/16-bit/mono>" }
 *   { type: "contentStart", role: string, contentType: string }
 *   { type: "contentEnd", contentType: string }
 *   { type: "done" }
 *   { type: "error", message: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const systemPrompt: string =
    body.systemPrompt ??
    "You are a professional technical interviewer. Ask one clear question at a time and listen carefully to the candidate.";

  const bedrockClient = createBedrockClient();
  const promptName = randomUUID();
  const systemContentName = randomUUID();
  const audioContentName = randomUUID();

  // We'll use an async generator to feed events into InvokeModelWithBidirectionalStreamCommand
  // The generator yields init events immediately, then waits for audio chunks
  // from the client. In this simple version, we only send the system prompt
  // and open the audio block — audio chunks come via a separate endpoint.
  //
  // For a full duplex implementation, use the standalone websocket-nodejs server.

  async function* inputStream() {
    // 1. Session start
    yield sessionStartEvent();

    // 2. Prompt start
    yield promptStartEvent(promptName);

    // 3. System prompt block
    yield textContentStartEvent(promptName, systemContentName, "SYSTEM");
    yield textInputEvent(promptName, systemContentName, systemPrompt);
    yield contentEndEvent(promptName, systemContentName);

    // 4. Open audio input block (client sends audio via separate API call in full duplex mode)
    yield audioContentStartEvent(promptName, audioContentName);

    // NOTE: In a real duplex setup, audio chunks would be yielded here as they
    // arrive from the WebSocket. For the simple SSE demonstration, we close
    // the audio block immediately to trigger a text-only response.
    yield contentEndEvent(promptName, audioContentName);

    // 5. End prompt → triggers model response
    yield promptEndEvent(promptName);

    // 6. End session
    yield sessionEndEvent();
  }

  // Create a ReadableStream for SSE to the browser
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  function sseWrite(data: object) {
    const line = `data: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(line)).catch(() => {});
  }

  // Run the Bedrock stream in background
  (async () => {
    try {
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: MODEL_ID,
        body: inputStream(),
      });

      const response = await bedrockClient.send(command);

      // Process response events
      for await (const event of response.body ?? []) {
        if (event.chunk?.bytes) {
          try {
            const text = new TextDecoder().decode(event.chunk.bytes);
            const json = JSON.parse(text);
            const e = json.event ?? {};

            if (e.contentStart) {
              sseWrite({
                type: "contentStart",
                role: e.contentStart.role ?? "",
                contentType: e.contentStart.type ?? "",
              });
            } else if (e.textOutput) {
              sseWrite({
                type: "text",
                role: e.textOutput.role ?? "ASSISTANT",
                content: e.textOutput.content ?? "",
              });
            } else if (e.audioOutput) {
              sseWrite({
                type: "audio",
                content: e.audioOutput.content ?? "",   // base64 PCM 24kHz
              });
            } else if (e.toolUse) {
              sseWrite({ type: "toolUse", toolName: e.toolUse.toolName });
            } else if (e.contentEnd) {
              sseWrite({
                type: "contentEnd",
                contentType: e.contentEnd.type ?? "",
              });
            } else if (e.promptEnd) {
              sseWrite({ type: "promptEnd" });
            } else if (e.completionEnd) {
              sseWrite({ type: "completionEnd" });
            }
          } catch {
            // Non-JSON chunk, skip
          }
        } else if (event.modelStreamErrorException) {
          sseWrite({
            type: "error",
            message: event.modelStreamErrorException.message ?? "Model stream error",
          });
        } else if (event.internalServerException) {
          sseWrite({
            type: "error",
            message: "Internal server error from Bedrock",
          });
        }
      }

      sseWrite({ type: "done" });
    } catch (err: any) {
      console.error("Nova 2 Sonic stream error:", err);
      sseWrite({ type: "error", message: err.message ?? "Unknown error" });
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// GET /api/sonic — health check
// ---------------------------------------------------------------------------
export async function GET() {
  return NextResponse.json({
    status: "ok",
    model: MODEL_ID,
    region: REGION,
    note: "POST to this endpoint with { systemPrompt } to start an SSE session.",
  });
}
