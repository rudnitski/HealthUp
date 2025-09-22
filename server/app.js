const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const fileUpload = require('express-fileupload');

const analyzeLabReportRouter = require('./routes/analyzeLabReport');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.static(publicDir));

app.use(
  fileUpload({
    limits: { fileSize: 10 * 1024 * 1024 },
    abortOnLimit: true,
    useTempFiles: false,
    preserveExtension: true,
    safeFileNames: true,
  }),
);

app.use('/api/analyze-labs', analyzeLabReportRouter);

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`HealthUp upload form available at http://localhost:${PORT}`);
});
