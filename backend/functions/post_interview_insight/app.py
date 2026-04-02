import json
import os
import boto3
import requests
import time

# Configuration
s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Initialize Bedrock Client
client = boto3.client(service_name="bedrock-runtime", region_name="us-east-1")

<<<<<<< HEAD
from langfuse.openai import OpenAI
from langfuse.decorators import observe

# Initialize OpenAI Client
client = OpenAI()

@observe()
=======
>>>>>>> f45901d (feat: implement real-time interview interface with gaze tracking and Sonic audio integration)
def lambda_handler(event, context):
    """
    Handler for Post Interview Insight.
    Triggered by S3 event when transcript is uploaded.
    Retrieves transcript from S3, analyzes it using Nova Pro, and saves insights to DynamoDB.
    """
    print(f"Received event: {json.dumps(event)}")
    
    # Check for Bearer Token and other config
    bearer_token = os.environ.get("AWS_BEARER_TOKEN_BEDROCK")
    if not all([bearer_token, transcript_bucket, persona_table_name]):
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "Configuration missing: AWS_BEARER_TOKEN_BEDROCK, TRANSCRIPT_BUCKET_NAME, or PERSONA_TABLE_NAME"})
        }
    
    # 1. Extract session_id from S3 event
    session_id = None
    
    # Handle S3 event structure
    if isinstance(event, dict):
        if "Records" in event and len(event["Records"]) > 0:
            record = event["Records"][0]
            if "s3" in record and "object" in record["s3"]:
                s3_key = record["s3"]["object"]["key"]
                if s3_key.startswith("transcripts/") and s3_key.endswith(".json"):
                    session_id = s3_key.replace("transcripts/", "").replace(".json", "")
                    print(f"Extracted session_id from S3 key: {session_id}")
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
        
        response_s3 = s3.get_object(Bucket=transcript_bucket, Key=transcript_key)
        transcript_data = json.loads(response_s3['Body'].read().decode('utf-8'))
        
        transcript_text = ""
        if isinstance(transcript_data, list):
            for msg in transcript_data:
                role = msg.get('role', 'unknown')
                content = msg.get('content', '')
                transcript_text += f"{role.upper()}: {content}\n"
        else:
            transcript_text = str(transcript_data)

        # 3. Use Bedrock Nova to get insights
        print(f"Generating insights for session {session_id} using Nova Pro...")
        
        system_prompt = """
        You are an expert Interview Coach and AI Analyst. You will be provided with a transcript of a job interview.
        Your goal is to provide deep insights and feedback to the candidate.
        
        IMPORTANT: Your entire response must be a single, valid JSON object with ONLY these keys: summary, strengths, weaknesses, score, next_steps.
        Do not include any other text BEFORE or AFTER the JSON.
        
        Structure:
        1. summary: A concise summary of the performance.
        2. strengths: A list of 3-5 key strengths.
        3. weaknesses: A list of 3-5 areas for improvement with examples.
        4. score: A numeric overall score out of 10.
        5. next_steps: Actionable advice.
        """
        
        user_prompt = f"Transcript:\n{transcript_text}"
        
        response = client.converse(
            modelId="amazon.nova-pro-v1:0",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"text": f"System Identity: {system_prompt}\n\nTask:\n{user_prompt}"}
                    ]
                }
            ],
            inferenceConfig={"temperature": 0.7}
        )
        
        raw_insights = response["output"]["message"]["content"][0]["text"]
        
        # Bedrock might return markdown-wrapped JSON, let's clean it just in case
        clean_json = re.sub(r'^```json\n|\n```$', '', raw_insights.strip())
        insights = json.loads(clean_json)
        
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
