import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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
    const { session_id, rating, feedback } = body;

    if (!session_id || !rating) {
      return NextResponse.json(
        { error: 'session_id and rating are required' },
        { status: 400 }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400 }
      );
    }

    const tableName = process.env.DYNAMODB_SUMMARY_TABLE || 'summary_table';

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { session_id },
        UpdateExpression: "SET user_rating = :r, user_feedback = :f, rating_timestamp = :t",
        ExpressionAttributeValues: {
          ':r': rating,
          ':f': feedback || '',
          ':t': new Date().toISOString(),
        },
      })
    );

    return NextResponse.json({
      message: 'Rating saved successfully',
      session_id: session_id,
      rating: rating,
    });
  } catch (error: any) {
    console.error('Error saving rating:', error);
    return NextResponse.json(
      { error: 'Failed to save rating', details: error.message },
      { status: 500 }
    );
  }
}