# HealthUp Project (`GEMINI.md`)

This document provides a comprehensive overview of the HealthUp project, designed to serve as a quick-start guide and ongoing reference for developers.

## 1. Project Overview

HealthUp is a full-stack web application that transforms unstructured lab report data (from PDFs and images) into a structured, queryable format within a PostgreSQL database. It provides a conversational AI interface that allows users to perform data analysis and generate visualizations through natural language queries.

**Core Functionality:**
*   **Data Ingestion:** Handles batch uploads of lab reports, with OCR processing powered by OpenAI GPT-4 Vision or Anthropic Claude Sonnet. It includes a Gmail integration to pull and process lab reports from email attachments.
*   **Data Structuring:** Automatically maps extracted lab analytes to a canonical vocabulary using a three-tier matching system (exact, fuzzy, and LLM-based).
*   **Conversational Analytics:** A chat interface allows users to query their health data using natural language. The system converts these queries into SQL, executes them against the database, and can generate plots for time-series data.
*   **Admin Interface:** A dedicated panel for reviewing and managing analyte mappings to ensure data quality.

**Architecture & Technology:**
*   **Backend:** A Node.js/Express monolith handles all business logic, including API endpoints, database interactions, and communication with external AI services.
*   **Frontend:** The application serves static HTML, CSS, and JavaScript files. The UI is split into a main user-facing application for data upload and chat, and an admin panel for data management.
*   **Database:** PostgreSQL is used for data storage, leveraging extensions like `pg_trgm` for fuzzy string matching.
*   **External APIs:**
    *   OpenAI / Anthropic for OCR and language model tasks.
    *   Google Gmail API for email integration.

## 2. Getting Started

### Prerequisites

*   Node.js (v18+) and npm
*   PostgreSQL (v14+) with `pg_trgm` and `pgcrypto` extensions enabled.
*   Poppler (`pdftoppm` command) for PDF processing.
*   An OpenAI API key.

### Setup and Configuration

1.  **Database Setup:** Create a dedicated user and database. It is **critical** to use a `UTF-8` locale to support all features.
    ```sh
    psql postgres -c "CREATE USER healthup_user WITH PASSWORD 'healthup_pass' LOGIN;"
    psql postgres -c "CREATE DATABASE healthup OWNER healthup_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
    ```

2.  **Environment Variables:** Create a `.env` file in the project root. The bare minimum configuration is:
    ```env
    DATABASE_URL=postgresql://healthup_user:healthup_pass@localhost:5432/healthup
    OPENAI_API_KEY=your-openai-api-key
    ```
    For a full list of options (e.g., enabling Gmail integration or switching OCR provider), see the `README.md` and `CLAUDE.md`. Key variables include:
    *   `OCR_PROVIDER`: `openai` or `anthropic`
    *   `SQL_GENERATOR_MODEL`: The model used for SQL generation.
    *   `GMAIL_INTEGRATION_ENABLED`: `true` to enable Gmail integration (dev only).

### Running the Application

1.  **Install Dependencies:**
    ```sh
    npm install
    ```

2.  **Start the Development Server:**
    ```sh
    npm run dev
    ```
    The server will start on `http://localhost:3000`. The application automatically applies the database schema (`server/db/schema.js`) on startup.

3.  **Run Tests:**
    ```sh
    npm test
    ```

## 3. Development Conventions

### Key Scripts

*   `npm run dev`: Starts the development server with auto-reloading.
*   `npm test`: Executes the test suite.
*   `node scripts/verify_mapping_setup.js`: Checks that the database is correctly configured for the analyte mapping feature.
*   `node scripts/backfill_analyte_mappings.js`: A utility script to process existing data with the latest mapping logic.

### Architectural Patterns

*   **Asynchronous Jobs:** Long-running tasks like OCR are handled asynchronously. The API immediately returns a `job_id`, and the client polls for the result. This prevents request timeouts.
*   **Server-Sent Events (SSE):** The conversational chat feature uses SSE for efficient, real-time streaming of AI responses from the server to the client.
*   **Declarative Schema:** The database schema is defined in `server/db/schema.js` and applied automatically at application start. This simplifies setup during development, but means there is no formal migration system.
*   **Multi-Provider Abstraction:** The OCR functionality is designed to be provider-agnostic, with a factory pattern (`server/services/vision/`) that can switch between OpenAI and Anthropic.
*   **Configuration via Environment Variables:** All configuration is managed through `.env` files, following 12-factor app principles.

## 4. Key Technical Details & Gotchas

This section highlights critical information for developers. For a more comprehensive guide, see `CLAUDE.md`.

*   **Database Locale is Critical:** The PostgreSQL database **MUST** use a UTF-8 locale (e.g., `en_US.UTF-8`). The default 'C' locale will break functionality, including fuzzy search and case conversion for non-ASCII characters.
*   **Express Route Order Matters:** When adding new routes, be aware that Express matches them in the order they are defined. Specific routes (e.g., `/api/jobs/summary`) must be defined *before* more generic, parameterized routes (e.g., `/api/jobs/:jobId`).
*   **Async Job Pattern for Long Operations:** Any operation that might take more than a few seconds (like OCR or email processing) must be implemented using the async job pattern to avoid request timeouts from proxies or load balancers.
*   **SSE for Streaming:** The chat interface uses Server-Sent Events (SSE) for streaming responses. This is a deliberate choice over WebSockets for its simplicity in a server-to-client streaming context.
*   **Gmail Integration is Dev-Only:** The Gmail integration feature is disabled in production environments for security and stability reasons. It should only be enabled for local development.

### Contribution Guidelines

*   **Read the Documentation:** Before starting, new contributors should read `README.md` and `CLAUDE.md` to understand the system architecture and development patterns.
*   **Understand the Prompts:** Review the files in the `prompts/` directory to understand how the application interacts with the language models.
*   **Verify Database Setup:** When making changes that affect the database schema or mapping logic, run `node scripts/verify_mapping_setup.js` to ensure the environment is correctly configured.
*   **Prioritize Structured Logging:** The application uses Pino for logging. Maintain this standard for any new features.
