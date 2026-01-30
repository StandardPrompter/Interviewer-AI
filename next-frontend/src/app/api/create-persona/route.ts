import { NextResponse } from 'next/server';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfnClient = new SFNClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { session_id, company_name, company_url, interviewer_name, interviewer_linkedin_url } = body;

    if (!session_id) {
      return NextResponse.json(
        { error: 'session_id is required' },
        { status: 400 }
      );
    }

    const stateMachineArn = process.env.STEP_FUNCTION_ARN;
    if (!stateMachineArn) {
      return NextResponse.json(
        { error: 'STEP_FUNCTION_ARN not configured' },
        { status: 500 }
      );
    }

    // Prepare input for Step Functions (matching the expected format)
    const executionInput = {
      session_id,
      company_name: company_name || '',
      company_url: company_url || '',
      interviewer_name: interviewer_name || '',
      interviewer_linkedin_url: interviewer_linkedin_url || '',
    };

    // Start Step Functions execution
    const command = new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify(executionInput),
    });

    const response = await sfnClient.send(command);

    return NextResponse.json({
      success: true,
      executionArn: response.executionArn,
      startDate: response.startDate?.toISOString(),
      message: 'Step Functions execution started',
    });
  } catch (error: any) {
    console.error('Error starting Step Functions execution:', error);
    return NextResponse.json(
      { error: 'Failed to start Step Functions execution', details: error.message },
      { status: 500 }
    );
  }
}
