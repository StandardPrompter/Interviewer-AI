import sys
import os
import json
import traceback
from unittest.mock import MagicMock

# 1. Setup Environment Variables
os.environ["CACHE_TABLE_NAME"] = "TestCacheTable"
os.environ["TABLE_NAME"] = "AgentStateTable"
os.environ["OPENAI_API_KEY"] = "sk-test"
os.environ["LINKEDIN_TABLE_NAME"] = "LinkedInTable"
os.environ["COMPANY_TABLE_NAME"] = "CompanyTable"
os.environ["PERSONA_TABLE_NAME"] = "PersonaTable"
os.environ["SCRAPINGDOG_API_KEY"] = "test-key"
os.environ["PARALLEL_AI_API_KEY"] = "pk"

# 2. Add functions to path
sys.path.append(os.path.join(os.path.dirname(__file__), '../functions'))

# 3. Setup Mocks in sys.modules
mock_boto3 = MagicMock()
mock_table = MagicMock()
mock_boto3.resource.return_value.Table.return_value = mock_table
mock_table.get_item.return_value = {} # Cache Miss
mock_table.put_item.return_value = {}
sys.modules["boto3"] = mock_boto3

mock_botocore = MagicMock()
sys.modules["botocore"] = mock_botocore
sys.modules["botocore.exceptions"] = mock_botocore

mock_parallel = MagicMock()
mock_client = MagicMock()
mock_status = MagicMock()
mock_status.output = json.dumps({"name": "Mock Company"})
mock_status.status = "succeeded"
mock_client.beta.task_run.result.return_value = mock_status
mock_client.beta.task_run.create.return_value.run_id = "run-1"
mock_parallel.Parallel.return_value = mock_client
sys.modules["parallel"] = mock_parallel

mock_types = MagicMock()
sys.modules["parallel.types"] = mock_types
sys.modules["parallel.types.beta"] = mock_types

mock_openai = MagicMock()
mock_completion = MagicMock()
mock_completion.choices = [MagicMock(message=MagicMock(content="AI Generated Persona Content"))]
sys.modules["openai"] = mock_openai

mock_langfuse = MagicMock()
mock_decorators = MagicMock()
mock_decorators.observe.return_value = lambda x=None, **kwargs: (lambda func: func)
sys.modules["langfuse"] = mock_langfuse
sys.modules["langfuse.decorators"] = mock_decorators

mock_requests = MagicMock()
mock_response = MagicMock()
mock_response.status_code = 200
mock_response.json.return_value = {
    "organic_results": [{"link": "https://linkedin.com/in/test-profile"}],
    "name": "Test Interviewer",
    "headline": "Senior Dev",
    "summary": "Experienced"
}
mock_requests.get.return_value = mock_response
mock_requests.post.return_value = mock_response
sys.modules["requests"] = mock_requests

# 4. Import Handlers
try:
    from interviewer_research import app as interviewer_research
    interviewer_research.client = MagicMock()
    interviewer_research.client.chat.completions.create.return_value = mock_completion
    
    from company_research import app as company_research
    
    from persona_generator import app as persona_generator
except ImportError:
    traceback.print_exc()
    sys.exit(1)

def test_workflow():
    print("=== Starting Local Workflow Test ===\n")

    workflow_input = {
        "session_id": "test-session-123",
        "interviewer_linkedin_url": "https://linkedin.com/in/test-profile",
        "company_url": "https://test-company.com"
    }
    print(f"Input: {json.dumps(workflow_input, indent=2)}\n")

    print("--- Step 1: Parallel Research ---")
    
    # Interviewer Research
    print("Invoking InterviewerResearchFunction...")
    int_response = interviewer_research.lambda_handler(workflow_input, None)
    print(f"Interviewer Research Result: {int_response['statusCode']}")
    
    # Company Research
    print("Invoking CompanyResearchFunction...")
    comp_response = company_research.lambda_handler(workflow_input, None)
    print(f"Company Research Result: {comp_response['statusCode']}")
    
    if mock_table.put_item.call_count >= 2:
        print(f"Cache Write Verified: put_item was called {mock_table.put_item.call_count} times.")

    print("\n--- Step 2: Persona Generation ---")
    
    parallel_output = [int_response, comp_response]
    
    # Persona Generator
    print("Invoking PersonaGeneratorFunction...")
    persona_response = persona_generator.lambda_handler(parallel_output, None)
    
    print(f"\nFinal Result: {persona_response['statusCode']}")

    print("\n=== Test Case 2: Interviewer Lookup by Name ===")
    
    workflow_input_2 = {
        "interviewer_name": "Jane Doe",
        "company_name": "Tech Corp",
        "company_url": "https://tech-corp.com"
    }
    
    int_response_2 = interviewer_research.lambda_handler(workflow_input_2, None)
    print(f"Interviewer Research Result: {int_response_2['statusCode']}")
    
    if int_response_2['statusCode'] == 200:
        print("Success! Handeled missing URL by searching.")

if __name__ == "__main__":
    try:
        test_workflow()
    except Exception:
        traceback.print_exc()
