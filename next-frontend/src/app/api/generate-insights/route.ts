import { NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

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

    // Try to get function name from env, or construct it from stack name
    let functionName = process.env.POST_INTERVIEW_INSIGHT_FUNCTION_NAME;
    
    if (!functionName) {
      // Try to construct function name (SAM/CloudFormation naming convention)
      const stackName = process.env.AWS_STACK_NAME || 'InterviewerProj';
      functionName = `${stackName}-PostInterviewInsightFunction`;
    }

    // Invoke the Lambda function
    const command = new InvokeCommand({
      FunctionName: functionName,
      Payload: JSON.stringify({ session_id }),
      InvocationType: 'RequestResponse', // Synchronous invocation
    });

    const response = await lambdaClient.send(command);

    if (response.FunctionError) {
      return NextResponse.json(
        { error: 'Lambda execution failed', details: response.FunctionError },
        { status: 500 }
      );
    }

    // Parse the response payload
    const payload = JSON.parse(
      new TextDecoder('utf-8').decode(response.Payload)
    );

    // Lambda returns { statusCode, body } structure
    let insights = null;
    if (payload.statusCode === 200 && payload.body) {
      const body = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
      insights = body.insights || body;
    } else if (payload.insights) {
      insights = payload.insights;
    }

    if (payload.statusCode !== 200) {
      return NextResponse.json(
        { error: 'Lambda execution failed', details: payload.body || payload.error },
        { status: payload.statusCode || 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Insights generated successfully',
      insights: insights,
      statusCode: 200,
    });
  } catch (error: any) {
    console.error('Error invoking post-interview insight Lambda:', error);
    return NextResponse.json(
      { error: 'Failed to generate insights', details: error.message },
      { status: 500 }
    );
  }
}

