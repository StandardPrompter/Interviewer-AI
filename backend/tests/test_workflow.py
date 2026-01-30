import sys
import os
import json
import logging
from unittest.mock import MagicMock

# Add src to path so we can import handlers
sys.path.append(os.path.join(os.path.dirname(__file__), '../src'))

# MOCK BOTO3 AND PARALLEL BEFORE IMPORTING HANDLERS
try:
    import boto3
except ImportError:
    print("boto3 not found, mocking it in sys.modules...")
    mock_boto3 = MagicMock()
    mock_botocore = MagicMock()
    sys.modules["boto3"] = mock_boto3
    sys.modules["botocore"] = mock_botocore
    sys.modules["botocore.exceptions"] = mock_botocore

try:
    import parallel
except ImportError:
    print("parallel-web not found, mocking it in sys.modules...")
    mock_parallel = MagicMock()
    mock_parallel_types = MagicMock()
    sys.modules["parallel"] = mock_parallel
    sys.modules["parallel.types"] = mock_parallel_types
    sys.modules["parallel.types.beta"] = mock_parallel_types # for McpServerParam

from handlers import interviewer_research, company_research, persona_generator

def test_workflow():
    print("=== Starting Local Workflow Test ===\n")

    # Mocking environment variables
    os.environ["CACHE_TABLE_NAME"] = "TestCacheTable"
    os.environ["TABLE_NAME"] = "AgentStateTable"
    
    # Configure the mock for DynamoDB
    mock_dynamo = MagicMock()
    mock_table = MagicMock()
    mock_dynamo.Table.return_value = mock_table
    
    # Simulate Cache Miss 
    mock_table.get_item.return_value = {} 
    # Simulate update_item success
    mock_table.update_item.return_value = {}

    # SETUP MOCKS FOR BOTH HANDLERS
    # We need to make sure both handlers use our mock for boto3
    if 'boto3' in sys.modules and not isinstance(sys.modules['boto3'], MagicMock):
        company_research.boto3.resource = MagicMock(return_value=mock_dynamo)
        interviewer_research.boto3.resource = MagicMock(return_value=mock_dynamo)
        persona_generator.boto3.resource = MagicMock(return_value=mock_dynamo)
    else:
        sys.modules['boto3'].resource.return_value = mock_dynamo

    # ... (Parallel SDK mocks omitted for brevity, keeping them existing) ...
    # Wait, I need to make sure I don't break the existing parallel mocks
    
    # Re-apply Parallel mocks since I'm replacing the block
    mock_client = MagicMock()
    mock_task_run = MagicMock()
    mock_task_run.run_id = "test_run_123"
    mock_client.beta.task_run.create.return_value = mock_task_run
    mock_status_success = MagicMock()
    mock_status_success.status = 'succeeded'
    mock_status_success.output = json.dumps({"name": "Mock Company"})
    mock_client.beta.task_run.result.return_value = mock_status_success
    sys.modules['parallel'].Parallel.return_value = mock_client
    
    # 1. Mock Input
    workflow_input = {
        "session_id": "test-session-123",
        "interviewer_linkedin_url": "https://linkedin.com/in/test-profile",
        "company_url": "https://test-company.com"
    }
    print(f"Input: {json.dumps(workflow_input, indent=2)}\n")

    # 2. Parallel Step Simulation
    print("--- Step 1: Parallel Research ---")
    
    # Interviewer Research
    print("Invoking InterviewerResearchFunction (Cache Miss Expected)...")
    int_response = interviewer_research.handler(workflow_input, None)
    print(f"Interviewer Research Result: {int_response['statusCode']}")
    
    # Company Research
    print("Invoking CompanyResearchFunction (Cache Miss Expected)...")
    comp_response = company_research.handler(workflow_input, None)
    print(f"Company Research Result: {comp_response['statusCode']}")
    
    # Verify put_item was called
    # Should be called twice, once for each handler
    if mock_table.put_item.call_count >= 2:
        print(f"Cache Write Verified: put_item was called {mock_table.put_item.call_count} times.")
    else:
        print(f"Cache Write Warning: put_item called {mock_table.put_item.call_count} times (Expected >= 2).")

    print("\n--- Step 2: Persona Generation ---")
    
    # Simulate Step Function passing array of results
    parallel_output = [int_response, comp_response]
    
    # Persona Generator
    print("Invoking PersonaGeneratorFunction...")
    persona_response = persona_generator.handler(parallel_output, None)
    
    print(f"\nFinal Result: {persona_response['statusCode']}")
    if "persona" in persona_response:
        print(f"Generated Persona Name: {persona_response['persona'].get('name')}")
    else:
        print(f"Body: {persona_response.get('body')}")

    print("\n=== Test Complete ===")

    print("\n=== Starting Test Case 2: Interviewer Lookup by Name ===")
    
    # 1. Mock Input (Missing URL, has Name/Company)
    workflow_input_2 = {
        "interviewer_name": "Jane Doe",
        "company_name": "Tech Corp",
        "company_url": "https://tech-corp.com"
    }
    print(f"Input: {json.dumps(workflow_input_2, indent=2)}\n")
    
    # Interviewer Research
    print("Invoking InterviewerResearchFunction (Search Expected)...")
    int_response_2 = interviewer_research.handler(workflow_input_2, None)
    print(f"Interviewer Research Result: {int_response_2['statusCode']}")
    
    if int_response_2['statusCode'] == 200:
        print("Success! Handeled missing URL by searching.")
        data = int_response_2.get('research_data', {})
        print(f"Found Name: {data.get('name')}")
    else:
        print(f"Failed. Body: {int_response_2.get('body')}")
        
    print("\n=== Test Case 2 Complete ===")

if __name__ == "__main__":
    test_workflow()
