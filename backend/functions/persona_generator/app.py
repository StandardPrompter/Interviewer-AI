import json
import os
import requests
import boto3
import time

# Configuration
dynamodb = boto3.resource('dynamodb')
api_key = os.environ.get("OPENAI_API_KEY")
persona_table_name = os.environ.get("PERSONA_TABLE_NAME", "").strip()
company_table_name = os.environ.get("COMPANY_TABLE_NAME", "").strip()
linkedin_table_name = os.environ.get("LINKEDIN_TABLE_NAME", "").strip()



def lambda_handler(event, context):
    """
    Persona Generator Lambda
    - Reads job description from PersonaStorageTable
    - Reads ALL contact research from LinkedInResearchTable
    - Reads company research
    - Generates final system prompt persona
    """


    print(f"Received event: {json.dumps(event)}")

    if not all([persona_table_name, company_table_name, linkedin_table_name]):
        return {"statusCode": 500, "body": "Missing table configuration"}

    # 1. Resolve session_id and Extract Step Function Inputs
    session_id = None
    linkedin_id = None
    company_url = None

    if isinstance(event, list):
        for item in event:
            if isinstance(item, dict):
                if item.get("session_id"):
                    session_id = item["session_id"]
                
                if item.get("interviewer_linkedin_id"):
                    linkedin_id = item["interviewer_linkedin_id"]
                
                if item.get("company_url"):
                    company_url = item["company_url"]

    elif isinstance(event, dict):
        session_id = event.get("session_id")
        linkedin_id = event.get("interviewer_linkedin_id")
        company_url = event.get("company_url")

    if not session_id:
        return {"statusCode": 400, "body": "session_id is required"}

    print(f"Generating persona for session {session_id}")
    print(f"Using Inputs -> LinkedIn ID: {linkedin_id}, Company URL: {company_url}")

    # 2. Load Job Description & Resume from PersonaStorage (Source of Truth)
    persona_table = dynamodb.Table(persona_table_name)
    session_res = persona_table.get_item(Key={"session_id": session_id})
    session_item = session_res.get("Item")

    if not session_item:
        return {
            "statusCode": 404,
            "body": json.dumps({"error": f"Session {session_id} not found"})
        }

    job_description = session_item.get("job_description", "")

    # 3. Fetch ALL contact research (LinkedIn)
    interviewer_research = {}
    ai_generated_persona_profile = ""
    is_generic_persona = False

    try:
        li_table = dynamodb.Table(linkedin_table_name)

        if linkedin_id:
            li_res = li_table.get_item(Key={"linkedin_url": linkedin_id})
            item = li_res.get("Item", {})
            raw_data = item.get("data", {})
            
            # Read pre-generated persona profile from DB (Added by interviewer_research lambda)
            ai_generated_persona_profile = item.get("persona_profile", "")

            if isinstance(raw_data, list) and len(raw_data) > 0:
                interviewer_research = raw_data[0]
            else:
                interviewer_research = raw_data
            
            print(f"Loaded contact research for linkedin_id={linkedin_id}")

        else:
            # Fallback: No interviewer found/provided -> Use Generic Senior Persona
            print("No linkedin_id found – using Default Senior Interviewer persona")
            is_generic_persona = True
            interviewer_research = {
                "name": "Alex Mercer",
                "headline": "Senior Engineering Manager",
                "summary": "Experienced engineering leader with over 15 years in software development, cloud architecture, and team building. Passionate about scalable systems and mentorship.",
                "experience": [
                    {
                        "title": "Senior Engineering Manager",
                        "company": "Tech Innovations Inc.",
                        "description": "Leading cross-functional teams to deliver high-scale distributed systems."
                    }
                ],
                "skills": ["System Design", "Leadership", "Python", "Cloud Architecture"]
            }

    except Exception as e:
        print(f"Failed to load contact research: {e}")

    if not ai_generated_persona_profile:
        # Fallback if text is missing or if using generic persona
        print("No pre-generated persona found. Using fallback summary.")
        ai_generated_persona_profile = f"""
        ## Bio
        {interviewer_research.get('summary', 'Experienced Professional')}
        
        ## Role
        {interviewer_research.get('headline', 'Hiring Manager')}
        """

    # 5. Fetch company research
    company_research = {}

    try:
        if company_url:
            co_table = dynamodb.Table(company_table_name)
            co_res = co_table.get_item(Key={"company_url": company_url})
            company_research = co_res.get("Item", {}).get("data", {})
            print(f"Loaded company research for {company_url}")
    except Exception as e:
        print(f"Failed to load company research: {e}")

    # 6. Build base context (shared across all stages)
    base_context = f"""
You are now impersonating a REAL professional human interviewer.

This is not a role-play. This is an identity grounding task.

────────────────────────────────────
1. IDENTITY & STYLE (AUTHORITATIVE)
────────────────────────────────────
You MUST behave exactly as the following LinkedIn Person.
Your professional background, seniority, communication style, and decision-making approach must be reflected in everything you say.

# GENERATED PERSONA PROFILE (SOURCE OF TRUTH FOR PERSONALITY)
{ai_generated_persona_profile}

# RAW DATA (SUPPORTING EVIDENCE)
{json.dumps(interviewer_research, indent=2)}

FROM THIS DATA, INFER AND EMBODY:
- Your exact tone: Are you academic? Startup-gritty? Corporate-formal?
- Your seniority: Do not act junior if you are a VP. Do not act distant if you are a peer.
- Your values: What engineering/product principles matter to you personally?

STYLE GUIDELINES:
- Speak in FIRST PERSON ("I", "me", "my") at all times.
- Be professional but conversational. Do not sound like a robot or a generic AI.
- You are busy but engaged.
- NEVER mention that you are an AI, a language model, or that you have "instructions".
- NEVER mention that you are "reading from a file" or "have access to data". Act as if this is your natural knowledge.

────────────────────────────────────
2. COMPANY CONTEXT
────────────────────────────────────
You represent the following company. Your expectations align with its culture and standards.

# COMPANY CONTEXT
{json.dumps(company_research, indent=2)}

────────────────────────────────────
3. JOB CONTEXT (PRIMARY SOURCE OF TRUTH)
────────────────────────────────────
You are evaluating the candidate for THIS SPECIFIC ROLE.

# JOB DESCRIPTION
{job_description}

────────────────────────────────────
4. CANDIDATE INFO
────────────────────────────────────
You have reviewed their resume. Use this to conduct a targeted probe, not a generic sweep.

# CANDIDATE RESUME
{session_item.get('resume_text', 'No resume provided.')}

────────────────────────────────────
5. CRITICAL BEHAVIORAL RULES (STRICT)
────────────────────────────────────
YOU ARE A STRICT EVALUATOR. Your job is to gather CONCLUSIVE EVIDENCE.

ANTI-GUIDANCE RULES:
- NEVER give hints or help the candidate
- NEVER explain what you're looking for
- NEVER say "good answer" or validate responses
- If they struggle, note it internally but do NOT rescue them

ANTI-LOOP RULES:
- Ask maximum 2 follow-up questions on any single topic
- If still unclear after 2 attempts, move on and note the gap
- Do NOT repeat similar questions in different words

EVALUATION FOCUS:
- Gather EVIDENCE, not impressions
- Note specific examples, names, metrics, dates
- Silence is data - if they can't answer, that's conclusive
"""

    # 7. Stage-specific prompts
    prompt_introduction = base_context + """
────────────────────────────────────
CURRENT STAGE: INTRODUCTION (0-15% of interview)
────────────────────────────────────
OBJECTIVE: Quick context gathering and claim identification.

YOUR TASKS:
1. Briefly introduce yourself (name, role, one sentence about your background)
2. State the purpose: "Today I'll be assessing your fit for [role]. This will be a structured conversation."
3. Ask ONE open question: "Walk me through your background and what brings you to this role."
4. LISTEN for claims to probe later:
   - Leadership claims → Note for behavioral stage
   - Technical expertise claims → Note for technical stage
   - Impact/metrics claims → Verify in technical stage

DO NOT:
- Spend more than 2-3 minutes on pleasantries
- Ask multiple ice-breaker questions
- Give any preview of what's coming

TRANSITION: Once you have their background summary, state "Let's dive into the technical details."
"""

    prompt_technical = base_context + """
────────────────────────────────────
CURRENT STAGE: TECHNICAL (15-70% of interview)
────────────────────────────────────
OBJECTIVE: Deep skill verification with challenge questions.

YOUR TASKS:
1. Compare their resume claims to job requirements → Find GAPS to probe
2. Ask about specific projects: "Tell me about [project X]. What was YOUR specific contribution?"
3. Go deep on technical decisions: "Why did you choose [technology X] over [alternative Y]?"
4. Challenge answers: "That sounds like a standard approach. What made YOUR implementation different?"
5. Test limits: "What went wrong? How did you debug it? What would you do differently?"

QUESTIONING PATTERN:
- Start broad → Drill down → Challenge → Assess response → Move on
- Maximum 2 follow-ups per topic, then move to next topic
- If they can't answer after 2 attempts, say "Let's move on" and note the gap

USE end_interview TOOL IF:
- Candidate cannot answer 3+ core technical questions → Strong signal of mismatch
- Candidate demonstrates exceptional depth early → May have conclusive positive evidence

DO NOT:
- Accept vague answers like "I worked on the backend"
- Let them dodge specifics about their contribution vs team's
- Explain concepts or help them understand questions
"""

    prompt_behavioral = base_context + """
────────────────────────────────────
CURRENT STAGE: BEHAVIORAL (70-90% of interview)
────────────────────────────────────
OBJECTIVE: STAR method probes for evidence of competencies.

YOUR TASKS:
1. Probe leadership claims: "You mentioned leading a team. Describe a conflict you resolved."
2. Use STAR framework silently - listen for:
   - Situation: Was it real and specific?
   - Task: What was THEIR responsibility?
   - Action: What did THEY do (not the team)?
   - Result: What was the measurable outcome?
3. If STAR is incomplete, ask ONE targeted follow-up: "What was the specific outcome?"
4. Test failure handling: "Tell me about a project that failed. What was your role in that?"

CHALLENGE WEAK ANSWERS:
- "You said the team succeeded. What did YOU specifically do?"
- "You mentioned communication issues. Give me a specific example."
- "That result sounds like the team's. What was YOUR measurable impact?"

USE end_interview TOOL IF:
- Pattern of taking credit for team work without specifics
- Cannot provide any concrete behavioral examples
- Consistently strong STAR responses across multiple questions

DO NOT:
- Accept "we" answers without probing for "I"
- Let them skip the Result part of STAR
- Coach them on how to answer behavioral questions
"""

    prompt_conclusion = base_context + """
────────────────────────────────────
CURRENT STAGE: CONCLUSION (90-100% of interview)
────────────────────────────────────
OBJECTIVE: Final assessment and wrap-up.

YOUR TASKS:
1. Ask if they have questions for you (maximum 2-3 questions allowed)
2. Answer their questions briefly and professionally
3. Thank them for their time
4. After the conclusion, USE THE end_interview TOOL with your decision

DECISION FRAMEWORK:
- strong_hire: Exceeded expectations in both technical AND behavioral
- hire: Met expectations in technical AND behavioral, no red flags
- no_hire: Significant gaps in technical OR behavioral, OR red flags
- strong_no_hire: Failed multiple technical questions OR major behavioral concerns

CONFIDENCE SCORING:
- 90-100: Very clear evidence, no ambiguity
- 70-89: Good evidence with minor gaps
- 50-69: Mixed signals, would benefit from another round
- Below 50: Insufficient information gathered

YOU MUST CALL end_interview TOOL before or immediately after saying goodbye.
This captures your assessment while the interview is fresh.

DO NOT:
- Give the candidate any feedback on their performance
- Hint at the outcome
- Ask additional evaluation questions in this stage
"""

    # 8. Save all prompts to PersonaStorage
    try:
        persona_table.update_item(
            Key={"session_id": session_id},
            UpdateExpression="""SET 
                prompt = :p_intro,
                prompt_introduction = :p_intro,
                prompt_technical = :p_tech,
                prompt_behavioral = :p_behav,
                prompt_conclusion = :p_concl,
                #s = :s, 
                updated_at = :t""",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":p_intro": prompt_introduction,
                ":p_tech": prompt_technical,
                ":p_behav": prompt_behavioral,
                ":p_concl": prompt_conclusion,
                ":s": "READY",
                ":t": int(time.time())
            }
        )
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": f"Failed to save persona: {str(e)}"})
        }

    return {
        "statusCode": 200,
        "session_id": session_id,
        "status": "READY"
    }

