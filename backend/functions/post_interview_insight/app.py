import json
import os
import boto3
import requests
import time

# Configuration
s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

api_key = os.environ.get("OPENAI_API_KEY")
transcript_bucket = os.environ.get("TRANSCRIPT_BUCKET_NAME")
persona_table_name = os.environ.get("PERSONA_TABLE_NAME")

def lambda_handler(event, context):
    """
    Handler for Post Interview Insight.
    Triggered by S3 event when transcript is uploaded.
    Retrieves transcript from S3, analyzes it using OpenAI, and saves insights to DynamoDB.
    """
    print(f"Received event: {json.dumps(event)}")
    
    if not all([api_key, transcript_bucket, persona_table_name]):
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "Configuration missing: OPENAI_API_KEY, TRANSCRIPT_BUCKET_NAME, or PERSONA_TABLE_NAME"})
        }
    
    # 1. Extract session_id from S3 event
    session_id = None
    
    # Handle S3 event structure
    if isinstance(event, dict):
        # Check if this is an S3 event
        if "Records" in event and len(event["Records"]) > 0:
            record = event["Records"][0]
            if "s3" in record and "object" in record["s3"]:
                # Extract key from S3 event: transcripts/{session_id}.json
                s3_key = record["s3"]["object"]["key"]
                # Extract session_id from key
                if s3_key.startswith("transcripts/") and s3_key.endswith(".json"):
                    session_id = s3_key.replace("transcripts/", "").replace(".json", "")
                    print(f"Extracted session_id from S3 key: {session_id}")
        # Fallback: check for direct session_id (for manual invocation)
        elif "session_id" in event:
            session_id = event.get("session_id")
    
    if not session_id:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "session_id is required. Could not extract from S3 event."})
        }

    try:
        # 2. Retrieve transcript from S3
        transcript_key = f"transcripts/{session_id}.json"
        print(f"Fetching transcript from S3: {transcript_bucket}/{transcript_key}")
        
        response = s3.get_object(Bucket=transcript_bucket, Key=transcript_key)
        transcript_data = json.loads(response['Body'].read().decode('utf-8'))
        
        # Assume transcript_data is a list of messages or a large string
        # format it for the prompt
        transcript_text = ""
        if isinstance(transcript_data, list):
            for msg in transcript_data:
                role = msg.get('role', 'unknown')
                content = msg.get('content', '')
                transcript_text += f"{role.upper()}: {content}\n"
        else:
            transcript_text = str(transcript_data)

        # 3. Use OpenAI to get insights
        print(f"Generating insights for session {session_id} using OpenAI...")
        
        system_prompt = """
        You are an expert Interview Coach and AI Analyst. You will be provided with a transcript of a job interview.
        Your goal is to provide deep insights and feedback to the candidate.
        
        Please provide:
        1. **Summary**: A concise summary of how the interview went.
        2. **Strengths**: 3-5 key strengths the candidate demonstrated.
        3. **Weaknesses**: 3-5 areas for improvement with specific examples.
        4. **Score**: An overall score out of 10 for the performance.
        5. **Next Steps**: actionable advice for the next interview.
        
        Format your response as a structured JSON object with these keys: summary, strengths, weaknesses, score, next_steps.
        """
        
        user_prompt = f"Transcript:\n{transcript_text}"
        
        openai_response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "response_format": { "type": "json_object" }
            }
        )
        openai_response.raise_for_status()
        insights = json.loads(openai_response.json()["choices"][0]["message"]["content"])
        
        # 4. Save insights to DynamoDB
        print(f"Saving insights to DynamoDB table {persona_table_name}...")
        table = dynamodb.Table(persona_table_name)
        table.update_item(
            Key={'session_id': session_id},
            UpdateExpression="SET insights = :i, analysis_status = :s, updated_at = :t",
            ExpressionAttributeValues={
                ':i': insights,
                ':s': 'COMPLETED',
                ':t': int(time.time())
            }
        )

        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Insights generated successfully",
                "session_id": session_id,
                "insights": insights
            })
        }

    except s3.exceptions.NoSuchKey:
        print(f"Transcript not found for session {session_id}")
        return {
            "statusCode": 404,
            "body": json.dumps({"error": f"Transcript for session {session_id} not found in S3"})
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
