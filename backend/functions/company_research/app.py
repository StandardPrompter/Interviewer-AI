import json
import os
import time
import requests
import boto3
from botocore.exceptions import ClientError
from parallel import Parallel
from parallel.types.beta import McpServerParam

# Configuration
dynamodb = boto3.resource('dynamodb')
api_key = os.environ.get("PARALLEL_AI_API_KEY")
table_name = os.environ.get("COMPANY_TABLE_NAME", "").strip() 
persona_table_name = os.environ.get("PERSONA_TABLE_NAME", "").strip()

def lambda_handler(event, context):
    """
    Handler for Company Research.
    Writes specifically to the Company Research table.
    """
    print(f"Received event: {json.dumps(event)}")
    
    company_url = event.get("company_url")
    company_name = event.get("company_name")
    session_id = event.get("session_id")

    if not table_name:
        return {"statusCode": 500, "body": "COMPANY_TABLE_NAME environment variable not set"}

    if not company_url and not company_name:
        return {"statusCode": 400, "body": json.dumps({"error": "Either company_url or company_name is required"})}

    table = dynamodb.Table(table_name)

    # 1. Check Table for existing data (Global Cache)
    # We prefer URL as key. If we only have name, we might skip cache or try a secondary index if it existed (for now, skip cache if no URL)
    
    if company_url:
        try:
            cache_response = table.get_item(Key={'company_url': company_url})
            if 'Item' in cache_response:
                print(f"Global cache hit for URL {company_url}")
                # Link session to this URL even on cache hit
                if session_id and persona_table_name:
                    try:
                        persona_table = dynamodb.Table(persona_table_name)
                        persona_table.update_item(
                            Key={'session_id': session_id},
                            UpdateExpression="SET company_url = :url",
                            ExpressionAttributeValues={':url': company_url}
                        )
                    except Exception as ex:
                        print(f"Failed to link session to cache: {str(ex)}")

                return {
                    "statusCode": 200,
                    "session_id": session_id,
                    "company_url": company_url
                }
        except Exception as e:
            print(f"Cache check failed: {str(e)}")

    # 2. Fetch from API
    search_target = company_url if company_url else company_name
    print(f"Fetching from Parallel AI for {search_target}...")
    
    if not api_key:
        print("No PARALLEL_AI_API_KEY found, returning mock data.")
        company_data = {
            "name": company_name or "Tech Corp",
            "industry": "Software Engineering",
            "culture": "Product-led, engineering-first culture.",
            "recent_news": "Recently announced expansion."
        }
    else:
        try:
            client = Parallel(api_key=api_key)
            prompt_input = f"Research the company {search_target}. Provide a summary of their business model, culture, and core technologies."
            if company_url:
                prompt_input = f"Research the company at {company_url}. Provide a summary of their business model, culture, and core technologies."

            task_run = client.beta.task_run.create(
                input=prompt_input,
                processor='lite',
                enable_events=False
            )
            
            # Polling for result
            max_retries = 30
            for _ in range(max_retries):
                task_run_result = client.beta.task_run.result(
                    run_id=task_run.run_id,
                    betas=["mcp-server-2025-07-17"]
                )
                if hasattr(task_run_result, 'output') and task_run_result.output:
                    raw_output = task_run_result.output
                    
                    # 1. Try to convert specialized object to dictionary
                    if not isinstance(raw_output, str):
                        try:
                            if hasattr(raw_output, 'model_dump'):
                                company_data = raw_output.model_dump()
                            elif hasattr(raw_output, 'dict'):
                                company_data = raw_output.dict()
                            else:
                                # Fallback to string if not a dict/model
                                company_data = {"raw_output": str(raw_output)}
                        except:
                            company_data = {"raw_output": str(raw_output)}
                    else:
                        # 2. If it's a string, try to parse as JSON
                        try:
                            company_data = json.loads(raw_output)
                        except:
                            company_data = {"raw_output": raw_output}
                    break
                time.sleep(2)
            else:
                 raise Exception("Parallel AI task timed out.")
        except Exception as e:
            return {"statusCode": 500, "body": json.dumps({"error": f"Parallel AI Failure: {str(e)}"}) }

    # 3. Save to Global Storage and Link to Session
    try:
        # Extract only the relevant content for storage
        save_data = company_data
        if isinstance(company_data, dict):
            if "content" in company_data:
                save_data = company_data["content"]
            pass

        # Use Name as URL key if URL is missing (fallback key)
        final_key = company_url if company_url else f"name:{company_name.lower().replace(' ', '_')}"

        # Save to bulk research cache
        table.put_item(Item={
            'company_url': final_key,
            'data': save_data,
            'updated_at': str(int(time.time()))
        })
        
        # Link session to this URL in Persona table
        if session_id and persona_table_name:
            persona_table = dynamodb.Table(persona_table_name)
            persona_table.update_item(
                Key={'session_id': session_id},
                UpdateExpression="SET company_url = :url",
                ExpressionAttributeValues={':url': final_key}
            )
            print(f"Linked session {session_id} to {final_key}")
            
        # Ensure the function returns the clean data
        company_data = save_data
    except Exception as e:
        print(f"Storage save or link failed: {str(e)}")

    return {
        "statusCode": 200,
        "session_id": session_id,
        "company_url": final_key if 'final_key' in locals() else company_url
    }
