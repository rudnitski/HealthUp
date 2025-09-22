# HealthUp - Lab Report Analysis

HealthUp is a web application that analyzes lab reports to extract key health data. Users can upload a PDF or image of their lab report, and the application will use the OpenAI Vision API to extract structured data, starting with Vitamin D levels and expanding to a full panel of results.

## Live Demo

A live demo is not available at this time.

## Features

*   **File Upload:** Upload lab reports as images (JPEG, PNG, etc.) or PDF documents.
*   **AI-Powered Analysis:** Uses OpenAI's `gpt-4o-mini` model to analyze lab reports.
*   **Data Extraction:** Extracts the following information from lab reports:
    *   Patient Name
    *   Date of Birth
    *   Specimen Collection Date
    *   Vitamin D measurements (including value, unit, and reference interval)
*   **Responsive UI:** A simple and clean user interface that displays the extracted data.

## Tech Stack

*   **Frontend:** HTML, CSS, Vanilla JavaScript
*   **Backend:** Node.js, Express.js
*   **AI:** OpenAI Vision API
*   **File Handling:** `express-fileupload` for uploads, `pdf-parse` and `pdftoppm` (Poppler) for PDF processing.

## Architecture

The application is a single-page application with a Node.js backend.

### Frontend

The frontend is built with vanilla HTML, CSS, and JavaScript. It provides a simple interface for uploading a lab report and displaying the analysis results. The frontend communicates with the backend via a REST API.

### Backend

The backend is a Node.js application using the Express.js framework. It has a single API endpoint that accepts a file upload, processes the file (converting PDFs to images if necessary), sends the data to the OpenAI Vision API for analysis, and then returns the structured data to the frontend.

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

*   Node.js (v14 or later)
*   npm
*   Poppler (`pdftoppm` command-line tool)

### Installation

1.  Clone the repo
    ```sh
    git clone https://github.com/your_username/HealthUp.git
    ```
2.  Install NPM packages
    ```sh
    npm install
    ```
3.  Create a `.env` file in the root of the project and add your OpenAI API key:
    ```
    OPENAI_API_KEY='your_api_key'
    ```

### Running the Application

To run the application in development mode, use the following command:

```sh
npm run dev
```

This will start the server on `http://localhost:3000`.

## API Endpoints

### `POST /api/analyze-vitamin-d`

This endpoint analyzes a lab report to extract Vitamin D and other patient data.

*   **Request:**
    *   Method: `POST`
    *   Content-Type: `multipart/form-data`
    *   Body: A form with a single file field named `analysisFile`. The file can be an image or a PDF.

*   **Success Response (200 OK):**
    *   Content-Type: `application/json`
    *   Body: A JSON object with the extracted data. See `server/routes/analyzeVitaminD.js` for the detailed structure.

*   **Error Responses:**
    *   `400 Bad Request`: If the file is missing, of an unsupported type, or if there are other issues with the request.
    *   `413 Payload Too Large`: If the file exceeds the size limit (10MB).
    *   `500 Internal Server Error`: If there is a server-side error, such as a missing OpenAI API key.
    *   `502 Bad Gateway`: If the OpenAI API request fails.

## Project Structure

```
/
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
├── docs/                  # Product Requirement Documents
├── node_modules/
├── public/                # Frontend static files
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── index.html
└── server/                # Backend server
    ├── app.js             # Express app setup
    └── routes/
        └── analyzeVitaminD.js # API route and logic
```

## Future Development

The next major feature planned is **Full Lab Results Extraction**, which will expand the analysis to extract all measurable parameters from a lab report, not just Vitamin D. This will provide users with a comprehensive, structured view of their health data.