import { NextResponse } from 'next/server';
import { SFNClient, DescribeExecutionCommand } from '@aws-sdk/client-sfn';

const sfnClient = new SFNClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const executionArn = searchParams.get('executionArn');

    if (!executionArn) {
      return NextResponse.json(
        { error: 'executionArn is required' },
        { status: 400 }
      );
    }

    const command = new DescribeExecutionCommand({
      executionArn,
    });

    const response = await sfnClient.send(command);

    return NextResponse.json({
      status: response.status,
      startDate: response.startDate?.toISOString(),
      stopDate: response.stopDate?.toISOString(),
      output: response.output,
      error: response.error,
    });
  } catch (error: any) {
    console.error('Error checking Step Functions execution:', error);
    return NextResponse.json(
      { error: 'Failed to check execution status', details: error.message },
      { status: 500 }
    );
  }
}

