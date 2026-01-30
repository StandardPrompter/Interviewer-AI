import os
import requests
import boto3
import time
import re
import json

# Configuration
dynamodb = boto3.resource("dynamodb")
api_key = os.environ.get("SCRAPINGDOG_API_KEY")
openai_api_key = os.environ.get("OPENAI_API_KEY")

interviewer_table_name = os.environ.get("LINKEDIN_TABLE_NAME", "").strip()


def generate_persona_profile(interviewer_data):
    """
    Uses LLM to transform raw LinkedIn data into a structured Persona Profile.
    """
    if not interviewer_data:
        return None

    system_msg = """You are an expert at profiling professionals. 
    Given raw LinkedIn data, generate a rich "Persona Profile" for this person.
    
    Output Format (Markdown):
    ## Bio
    [Concise professional bio]
    
    ## Communication Style
    [Infer their style: e.g., Formal, technical, direct, visionary, academic, etc.]
    
    ## Key expertise
    [Top 3-5 confirmed skills based on history]
    
    ## Interviewing Approach (Inferred)
    [Based on their role/background, how would they interview? e.g. "Focuses on system design constraints", "Digs into product metrics", "Cares about code craft"]
    """

    user_msg = f"Raw LinkedIn Data: {json.dumps(interviewer_data)}"

    try:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {openai_api_key}"
        }
        payload = {
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg}
            ]
        }
        
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data['choices'][0]['message']['content']

    except Exception as e:
        print(f"LLM Persona Generation Failed: {e}")
        return None


def extract_linkedin_id(linkedin_url: str) -> str | None:
    """
    Extract LinkedIn profile handle from URL.
    """
    if not linkedin_url:
        return None
    match = re.search(r"linkedin\.com/in/([^/?]+)", linkedin_url)
    return match.group(1) if match else None


def find_linkedin_url(name, company):
    """
    Uses Scrapingdog Google Search API to find LinkedIn profile URL.
    """
    query = f"site:linkedin.com/in/ {name} {company}"
    url = "https://api.scrapingdog.com/google/"
    params = {"api_key": api_key, "query": query}

    try:
        res = requests.get(url, params=params, timeout=60)
        res.raise_for_status()
        data = res.json()
        if data.get("organic_results"):
            return data["organic_results"][0].get("link")
    except Exception as e:
        print(f"Google search failed: {e}")

    return None


def fetch_linkedin_profile(linkedin_id):
    """
    Uses Scrapingdog Profile API.
    """
    url = "https://api.scrapingdog.com/profile"
    params = {
        "api_key": api_key,
        "id": linkedin_id,
        "type": "profile",
        "premium": "true",
        "webhook": "false",
        "fresh": "true"
    }

    max_attempts = 15
    for attempt in range(max_attempts):
        try:
            print(f"Fetching LinkedIn profile {linkedin_id} (attempt {attempt + 1})")
            res = requests.get(url, params=params, timeout=60)

            if res.status_code == 200:
                return res.json(), None
            if res.status_code == 202:
                time.sleep(10)
                continue

            return None, f"{res.status_code}: {res.text}"
        except requests.exceptions.Timeout:
            time.sleep(10)
        except Exception as e:
            return None, str(e)

    return None, "Timed out waiting for scrape"


def lambda_handler(event, context):
    """
    Interviewer Research Lambda
    - interviewer_url (PK) = LinkedIn ID
    """

    print(f"Received event: {json.dumps(event)}")

    if not interviewer_table_name:
        return {"statusCode": 500, "body": "LINKEDIN_TABLE_NAME not set"}

    interviewer_name = event.get("interviewer_name")
    company_name = event.get("company_name") or event.get("interviewer_company")
    linkedin_url = event.get("interviewer_linkedin_url")
    session_id = event.get("session_id")

    # 1. Check for Optional Inputs
    if not linkedin_url and not (interviewer_name and company_name):
        print("No interviewer details provided. Skipping research.")
        return {
            "statusCode": 200,
            "session_id": session_id,
            "status": "SKIPPED",
            "message": "No interviewer details provided"
        }

    interviewer_table = dynamodb.Table(interviewer_table_name)

    # 2. Resolve LinkedIn URL if missing
    if not linkedin_url:
        linkedin_url = find_linkedin_url(interviewer_name, company_name)
        if not linkedin_url:
            print(f"Could not find LinkedIn URL for {interviewer_name} at {company_name}")
            return {
                "statusCode": 200,
                "session_id": session_id,
                "status": "FAILED_OPTIONAL",
                "message": "LinkedIn profile not found"
            }

    # 3. Extract LinkedIn ID (AUTHORITATIVE IDENTIFIER)
    linkedin_id = extract_linkedin_id(linkedin_url)
    if not linkedin_id:
        return {
            "statusCode": 200,
            "session_id": session_id,
            "status": "FAILED_OPTIONAL",
            "message": "Invalid LinkedIn URL format"
        }

    # 4. Cache lookup (GLOBAL)
    try:
        cache_res = interviewer_table.get_item(
            Key={"linkedin_url": linkedin_id}
        )
        if "Item" in cache_res:
            print(f"Cache hit for linkedin_id={linkedin_id}")

            return {
                "statusCode": 200,
                "session_id": session_id,
                "interviewer_linkedin_id": linkedin_id,
                "interviewer_linkedin_url": linkedin_url,
                "status": "SUCCESS"
            }
    except Exception as e:
        print(f"Cache check failed: {e}")

    # 5. Fetch fresh LinkedIn profile
    research_data, err = fetch_linkedin_profile(linkedin_id)
    if err:
        print(f"Scraping failed: {err}")
        return {
            "statusCode": 200,
            "session_id": session_id,
            "status": "FAILED_OPTIONAL",
            "message": f"Scraping failed: {err}"
        }

    # 6. Generate AI Persona Profile
    print("Generating AI Persona Profile...")
    generated_profile = generate_persona_profile(research_data)

    # 7. Save to DynamoDB (GLOBAL CACHE)
    try:
        print(f"Attempting to save research for linkedin_url={linkedin_id} to table {interviewer_table_name}...")
        interviewer_table.put_item(
            Item={
                "linkedin_url": linkedin_id,  # PK
                "data": research_data,
                "persona_profile": generated_profile, # NEW field
                "updated_at": int(time.time())
            }
        )
        print(f"✅ Successfully saved research for linkedin_url={linkedin_id}")

    except Exception as e:
        print(f"❌ Failed to store interviewer research: {e}")

    return {
        "statusCode": 200,
        "session_id": session_id,
        "interviewer_linkedin_id": linkedin_id,
        "interviewer_linkedin_url": linkedin_url,
        "status": "SUCCESS"
    }

