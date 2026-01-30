import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { session_id, job_description, company_name, company_url, interviewer_name, interviewer_linkedin_url } = body;

    if (!session_id || !company_name) {
      return NextResponse.json(
        { error: 'session_id and company_name are required' },
        { status: 400 }
      );
    }

    const tableName = process.env.DYNAMODB_PERSONA_TABLE || 'PersonaStorageTable';
    const timestamp = Math.floor(Date.now() / 1000).toString();

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          session_id,
          job_description: job_description || '',
          company_name,
          company_url: company_url || '',
          interviewer_name: interviewer_name || '',
          interviewer_linkedin_url: interviewer_linkedin_url || '',
          created_at: timestamp,
          updated_at: timestamp,
          status: 'PENDING',
        },
      })
    );

    return NextResponse.json({
      success: true,
      message: 'Job description saved successfully',
      session_id,
    });
  } catch (error: any) {
    console.error('Error saving job description:', error);
    return NextResponse.json(
      { error: 'Failed to save job description', details: error.message },
      { status: 500 }
    );
  }
}

