# HealthUp Upload Form MVP

Frontend-only prototype that lets a user choose an image or PDF and displays the file name instantly. Built to match the `PRD_Upload_Form.txt` requirements.

## Prerequisites

- Node.js 18+
- npm 9+

## Setup

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

The app serves at http://localhost:3000. Select a file to see `You selected: <filename>` appear below the input. Clear the selection to remove the message.

## Project Structure

```
public/
  index.html     # Upload form page
  css/style.css  # Minimal responsive styles
  js/app.js      # File selection behaviour
server/
  app.js         # Express static server
```

## Testing the Acceptance Criteria

1. Start the server with `npm run dev` and open the site.
2. Pick JPEG, PNG, and PDF files; the message updates with each filename.
3. Clear the file picker; the message disappears.
4. Navigate with keyboard (Tab/Space/Enter) to confirm accessibility support.
