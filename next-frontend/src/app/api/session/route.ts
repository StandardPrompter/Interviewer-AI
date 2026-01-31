import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

export async function POST(req: Request) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error('OPENAI_API_KEY is not set in environment variables');
        return NextResponse.json({ error: 'OPENAI_API_KEY is not set' }, { status: 500 });
    }

    try {
        const body = await req.json();
        const { session_id } = body;

        let instructions = "You are a professional technical interviewer. Conduct a natural, conversational interview.";

        // Retrieve prompt from DynamoDB if session_id is provided
        if (session_id) {
            try {
                const tableName = process.env.DYNAMODB_PERSONA_TABLE || 'PersonaStorageTable';

                const response = await docClient.send(
                    new GetCommand({
                        TableName: tableName,
                        Key: { session_id },
                    })
                );

                if (response.Item && response.Item.prompt) {
                    instructions = response.Item.prompt;
                    console.log('✓ Retrieved prompt from PersonaStorageTable for session:', session_id);
                } else {
                    console.warn('⚠ Prompt not found in PersonaStorageTable for session:', session_id);
                }
            } catch (dbError: any) {
                console.error('Error retrieving prompt from DynamoDB:', dbError);
                // Continue with default instructions if DB lookup fails
            }
        }
        const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-realtime-preview',
                voice: 'ballad',
                instructions: instructions,
                input_audio_transcription: {
                    model: 'gpt-4o-mini-transcribe'
                }
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI API error:', errorText);
            return NextResponse.json({ error: 'Failed to generate session' }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Error in /api/session:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
