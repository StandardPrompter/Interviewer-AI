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
  try {
    const body = await req.json();
    const { session_id } = body;

    if (!session_id) {
      return NextResponse.json(
        { error: 'session_id is required' },
        { status: 400 }
      );
    }

    const tableName = process.env.DYNAMODB_SUMMARY_TABLE || 'summary_table';

    const response = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { session_id },
      })
    );

    if (!response.Item) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    const insights = response.Item.insights || null;
    const analysis_status = response.Item.analysis_status || 'PENDING';

    if (!insights) {
      return NextResponse.json(
        {
          error: 'Insights not yet available',
          analysis_status: analysis_status
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      session_id: response.Item.session_id,
      insights: insights,
      analysis_status: analysis_status,
    });
  } catch (error: any) {
    console.error('Error fetching insights:', error);
    return NextResponse.json(
      { error: 'Failed to fetch insights', details: error.message },
      { status: 500 }
    );
  }
}