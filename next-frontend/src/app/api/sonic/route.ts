import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { NextResponse } from 'next/server';

// Note: The SDK should automatically pick up AWS_BEARER_TOKEN_BEDROCK 
// if it's set in the environment.
const client = new BedrockRuntimeClient({
    region: 'us-east-1',
});

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const audioFile = formData.get('audio') as Blob;
        const sessionId = formData.get('session_id') as string;
        let instructions = formData.get('instructions') as string || "You are a professional technical interviewer.";

        if (!audioFile) {
            return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
        }

        const audioBuffer = await audioFile.arrayBuffer();
        const audioBytes = new Uint8Array(audioBuffer);

        const command = new ConverseStreamCommand({
            modelId: "amazon.nova-sonic-v1:0",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            audio: {
                                format: "wav", // Bedrock Nova Sonic supports wav
                                bytes: audioBytes
                            }
                        }
                    ],
                }
            ],
            inferenceConfig: {
                temperature: 0.7,
                maxTokens: 2000,
            },
            system: [
                { text: instructions }
            ]
        });

        const response = await client.send(command);

        // Create a ReadableStream to stream the response back to the client
        const stream = new ReadableStream({
            async start(controller) {
                if (!response.stream) {
                    controller.close();
                    return;
                }

                for await (const chunk of response.stream) {
                    // Bedrock ConverseStream returns various event types
                    if (chunk.contentBlockDelta) {
                        const delta = chunk.contentBlockDelta.delta;
                        if (delta?.text) {
                            controller.enqueue(JSON.stringify({ type: 'text', data: delta.text }) + '\n');
                        }
                    }

                    if (chunk.contentBlockStart) {
                        const start = chunk.contentBlockStart.start;
                        if (start?.audio) {
                            // Audio start event
                            controller.enqueue(JSON.stringify({ type: 'audio_start' }) + '\n');
                        }
                    }

                    // Nova Sonic sends audio bytes in the stream
                    // We need to check how the JS SDK exposes these bytes
                    // In the Python SDK it's in the event stream.
                    // For JS, we check chunk properties.
                    if ((chunk as any).messageStart) {
                        controller.enqueue(JSON.stringify({ type: 'message_start' }) + '\n');
                    }

                    // If Bedrock sends audio bytes in chunks
                    if ((chunk as any).contentBlockDelta?.delta?.audio) {
                        const audioBytes = (chunk as any).contentBlockDelta.delta.audio;
                        // Convert to base64 for ease of transport in JSON stream
                        const base64Audio = Buffer.from(audioBytes).toString('base64');
                        controller.enqueue(JSON.stringify({ type: 'audio', data: base64Audio }) + '\n');
                    }

                    if (chunk.messageStop) {
                        controller.enqueue(JSON.stringify({ type: 'message_stop' }) + '\n');
                    }
                }
                controller.close();
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'application/x-ndjson',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('Error in Nova Sonic proxy:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
