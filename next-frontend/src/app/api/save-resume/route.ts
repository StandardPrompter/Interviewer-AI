import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import PDFParser from 'pdf2json';

const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('resume') as File;
        const session_id = formData.get('session_id') as string;

        if (!file) {
            return NextResponse.json(
                { error: 'No resume file provided' },
                { status: 400 }
            );
        }

        if (!session_id) {
            return NextResponse.json(
                { error: 'session_id is required' },
                { status: 400 }
            );
        }

        // Read file buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Parse PDF using pdf2json
        const pdfParser = new PDFParser(null, 1 as any); // 1 = text content only

        const resume_text = await new Promise<string>((resolve, reject) => {
            pdfParser.on("pdfParser_dataError", (errData: any) => reject(new Error(errData.parserError)));
            pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
                // getRawTextContent() is simpler but let's just use the text logic if needed
                // For pdf2json, getRawTextContent() returns text.
                resolve(pdfParser.getRawTextContent());
            });
            pdfParser.parseBuffer(buffer);
        });

        const tableName = process.env.DYNAMODB_PERSONA_TABLE || 'PersonaStorageTable';
        const timestamp = Math.floor(Date.now() / 1000).toString();

        // Update existing session with resume text
        await docClient.send(
            new UpdateCommand({
                TableName: tableName,
                Key: {
                    session_id,
                },
                UpdateExpression: 'SET resume_text = :r, updated_at = :t',
                ExpressionAttributeValues: {
                    ':r': resume_text,
                    ':t': timestamp,
                },
            })
        );

        return NextResponse.json({
            success: true,
            message: 'Resume text processed and saved successfully',
            text_preview: resume_text.substring(0, 100) + '...',
        });
    } catch (error: any) {
        console.error('Error processing resume:', error);
        return NextResponse.json(
            { error: 'Failed to process resume', details: error.message },
            { status: 500 }
        );
    }
}
