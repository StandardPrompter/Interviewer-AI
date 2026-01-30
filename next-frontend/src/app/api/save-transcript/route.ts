import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { session_id, transcript } = body;

    if (!session_id || !transcript) {
      return NextResponse.json(
        { error: 'session_id and transcript are required' },
        { status: 400 }
      );
    }

    const bucketName = process.env.S3_TRANSCRIPT_BUCKET;
    if (!bucketName) {
      return NextResponse.json(
        { error: 'S3_TRANSCRIPT_BUCKET not configured' },
        { status: 500 }
      );
    }

    const key = `transcripts/${session_id}.json`;
    const transcriptJson = JSON.stringify(transcript, null, 2);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: transcriptJson,
      ContentType: 'application/json',
    });

    await s3Client.send(command);

    return NextResponse.json({
      success: true,
      message: 'Transcript saved successfully',
      session_id,
      s3_key: key,
    });
  } catch (error: any) {
    console.error('Error saving transcript to S3:', error);
    return NextResponse.json(
      { error: 'Failed to save transcript', details: error.message },
      { status: 500 }
    );
  }
}

