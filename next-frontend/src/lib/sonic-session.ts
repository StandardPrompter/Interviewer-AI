/**
 * Shared Nova Sonic session state and event builders.
 *
 * This module lives outside the route files so that both
 * POST /api/sonic and POST /api/sonic/audio can access the same
 * in-memory session map and event helpers.
 */

// ── Audio config ─────────────────────────────────────────────────────────────

const AUDIO_INPUT_CONFIG = {
  mediaType: "audio/lpcm",
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
  audioType: "SPEECH",
  encoding: "base64",
};

export const AUDIO_OUTPUT_CONFIG = {
  mediaType: "audio/lpcm",
  sampleRateHertz: 24000,
  sampleSizeBits: 16,
  channelCount: 1,
  voiceId: "matthew",
  encoding: "base64",
  audioType: "SPEECH",
};

// ── Session state ────────────────────────────────────────────────────────────

export interface SessionState {
  promptName: string;
  audioContentName: string;
  queue: Array<{ chunk: { bytes: Uint8Array } }>;
  resolve: (() => void) | null;
  closed: boolean;
}

type SonicGlobal = typeof globalThis & {
  __sonicSessions?: Map<string, SessionState>;
};

const sonicGlobal = globalThis as SonicGlobal;
const sessions = sonicGlobal.__sonicSessions ?? new Map<string, SessionState>();
if (!sonicGlobal.__sonicSessions) {
  sonicGlobal.__sonicSessions = sessions;
}

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export function setSession(sessionId: string, session: SessionState): void {
  sessions.set(sessionId, session);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function sessionCount(): number {
  return sessions.size;
}

// ── Event builders ───────────────────────────────────────────────────────────

function encode(eventObj: object): { chunk: { bytes: Uint8Array } } {
  return {
    chunk: { bytes: new TextEncoder().encode(JSON.stringify(eventObj)) },
  };
}

export function sessionStartEvent() {
  return encode({
    event: {
      sessionStart: {
        inferenceConfiguration: { maxTokens: 1024, topP: 0.9, temperature: 0.7 },
      },
    },
  });
}

export function promptStartEvent(promptName: string, voiceId = "matthew") {
  return encode({
    event: {
      promptStart: {
        promptName,
        textOutputConfiguration: { mediaType: "text/plain" },
        audioOutputConfiguration: { ...AUDIO_OUTPUT_CONFIG, voiceId },
        toolUseOutputConfiguration: { mediaType: "application/json" },
        toolConfiguration: { tools: [] },
      },
    },
  });
}

export function textContentStartEvent(
  promptName: string,
  contentName: string,
  role: "SYSTEM" | "USER" | "ASSISTANT" = "SYSTEM"
) {
  return encode({
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

export function textInputEvent(promptName: string, contentName: string, content: string) {
  return encode({
    event: { textInput: { promptName, contentName, content } },
  });
}

export function audioContentStartEvent(promptName: string, contentName: string) {
  return encode({
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

export function audioInputEvent(promptName: string, contentName: string, base64Audio: string) {
  return encode({
    event: { audioInput: { promptName, contentName, content: base64Audio } },
  });
}

export function contentEndEvent(promptName: string, contentName: string) {
  return encode({
    event: { contentEnd: { promptName, contentName } },
  });
}

export function promptEndEvent(promptName: string) {
  return encode({ event: { promptEnd: { promptName } } });
}

export function sessionEndEvent() {
  return encode({ event: { sessionEnd: {} } });
}
