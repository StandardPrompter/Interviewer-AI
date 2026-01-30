# Interviewer-AI: Realtime Voice-to-Voice AI Interviewer

**Interviewer-AI** is a cutting-edge full-stack application designed to simulate realistic job interviews. By combining deep automated research with realtime voice AI, it creates custom interviewer personas that challenge candidates just like real hiring managers.

## 🚀 Features

- **Profile & Context Analysis**: Upload your resume (PDF) and the target job description to tailor the interview context.
- **Automated Deep Research**:
  - **Interviewer Research**: Scrapes professional background data to understand who is interviewing you.
  - **Company Research**: Analyzes the target company's culture, products, and recent news.
  - **Persona Generation**: Synthesizes all data to create a hyper-realistic interviewer persona (e.g., "The Technical Stickler," "The Culture-Fit HR Manager").
- **Realtime Voice Interview**: Conduct fluid, low-latency voice-to-voice conversations using OpenAI's Realtime API.
- **Post-Interview Insights**: Automatically records transcripts and generates actionable feedback on your performance.

## 🏗️ Architecture

The project is a monorepo divided into a Serverless Backend and a Modern Frontend.

### Backend (AWS SAM)
Built with **AWS Serverless Application Model (SAM)** and **Python 3.11**.
- **Orchestration**: AWS Step Functions coordinates the parallel research workflows.
- **Compute**: AWS Lambda (Container Image based).
  - `InterviewerResearchFunction`: Gathers data on the interviewer.
  - `CompanyResearchFunction`: Analyzes target company data.
  - `PersonaGeneratorFunction`: Creates the system prompt/persona.
  - `PostInterviewInsightFunction`: Triggered by S3 upload to analyze transcripts.
- **Storage**:
  - **DynamoDB**: Stores personas, company data, and LinkedIn research.
  - **S3**: Stores interview transcripts and resumes.

### Frontend (Next.js)
Built with **Next.js 16 (App Router)** and **Tailwind CSS v4**.
- **UI/UX**: Modern, glass-morphism design with `lucide-react` icons.
- **Voice Integration**: WebRTC-based connection for realtime audio streaming.
- **State Management**: React Server Components & Client Hooks.

## 🛠️ Tech Stack

- **Frontend**: Next.js 16, React 19, TailwindCSS, TypeScript.
- **Backend**: Python 3.11, AWS Lambda, Step Functions, DynamoDB, S3.
- **Infrastructure**: Docker (for Lambda builds), AWS SAM.
- **AI Services**: OpenAI Realtime API, Third-party Scraping APIs.

## ⚡ Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11
- Docker (running)
- AWS CLI & SAM CLI installed and configured

### 1. Backend Setup
Navigate to the backend directory and deploy the serverless stack.

```bash
cd backend
# Create a .env file if needed for local testing (see .env.example)
sam build
sam deploy --guided
```

### 2. Frontend Setup
Navigate to the frontend directory and start the development server.

```bash
cd next-frontend
npm install
```

Create a `.env.local` file in `next-frontend/` with the following variables:

```env
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-south-1

# Resources (Output from SAM Deploy)
S3_RESUME_BUCKET=your-resume-bucket-name
S3_TRANSCRIPT_BUCKET=your-transcript-bucket-name
STEP_FUNCTION_ARN=your-research-state-machine-arn
DYNAMODB_PERSONA_TABLE=your-persona-table-name
DYNAMODB_SUMMARY_TABLE=your-summary-table-name

# API Keys
OPENAI_API_KEY=your_openai_key
NEXT_PUBLIC_API_URL=http://localhost:3000
```

Run the development server:

```bash
npm run dev
```

Visit `http://localhost:3000` to start using the application.

## 📄 License
[MIT](LICENSE)
