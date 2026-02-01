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

// Valid stages and their corresponding DynamoDB field names
const STAGE_PROMPT_MAP: Record<string, string> = {
    'introduction': 'prompt_introduction',
    'technical': 'prompt_technical',
    'behavioral': 'prompt_behavioral',
    'conclusion': 'prompt_conclusion',
};

// End interview tool definition
const END_INTERVIEW_TOOL = {
    type: "function",
    name: "end_interview",
    description: "End the interview when you have conclusive evidence to make a hiring decision. Call this when you have enough information to confidently recommend hire or no-hire.",
    parameters: {
        type: "object",
        properties: {
            decision: {
                type: "string",
                enum: ["strong_hire", "hire", "no_hire", "strong_no_hire"],
                description: "Your hiring recommendation based on the interview"
            },
            confidence: {
                type: "number",
                description: "Confidence level 0-100 in your decision"
            },
            reasoning: {
                type: "string",
                description: "Brief explanation for your decision"
            }
        },
        required: ["decision", "confidence", "reasoning"]
    }
};

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { session_id, stage } = body;

        if (!session_id) {
            return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
        }

        if (!stage || !STAGE_PROMPT_MAP[stage]) {
            return NextResponse.json({
                error: 'Invalid stage. Must be one of: introduction, technical, behavioral, conclusion'
            }, { status: 400 });
        }

        const tableName = process.env.DYNAMODB_PERSONA_TABLE || 'PersonaStorageTable';
        const promptField = STAGE_PROMPT_MAP[stage];

        const response = await docClient.send(
            new GetCommand({
                TableName: tableName,
                Key: { session_id },
                ProjectionExpression: promptField,
            })
        );

        if (!response.Item || !response.Item[promptField]) {
            console.warn(`⚠ Prompt not found for stage '${stage}' in session:`, session_id);
            return NextResponse.json({
                error: `Prompt not found for stage: ${stage}`
            }, { status: 404 });
        }

        const prompt = response.Item[promptField];
        console.log(`✓ Retrieved ${stage} prompt for session:`, session_id);

        return NextResponse.json({
            prompt,
            stage,
            tools: [END_INTERVIEW_TOOL],
        });

    } catch (error: any) {
        console.error('Error in /api/get-stage-prompt:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
