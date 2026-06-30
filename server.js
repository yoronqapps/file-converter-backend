import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());

// 🔒 SECURITY CONFIGURATION
const ALLOWED_EXTENSIONS = ['docx', 'doc', 'cfb', 'txt', 'xlsx', 'xls', 'pptx', 'ppt', 'md', 'pdf', 'png', 'jpg', 'jpeg', 'webp'];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB Limit

const upload = multer({
  dest: path.join(__dirname, 'tmp'),
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split('.').pop().toLowerCase();

    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true); // Extension is allowed
    } else {
      cb(new Error(`Security block: File type .${ext} is unauthorized.`), false);
    }
  }
});

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://localhost:3000';
const PDF2DOCX_URL = process.env.PDF2DOCX_URL || 'http://pdf2docx-service.railway.internal:5000';

app.post('/convert', upload.single('file'), async (req, res) => {
  const targetFormat = req.body.target;
  const inputFile = req.file;

  if (!inputFile || !targetFormat) {
    return res.status(400).json({ error: 'Missing file or target format' });
  }

  const sourceExt = inputFile.originalname.split('.').pop().toLowerCase();

  try {
    const fileBuffer = await fs.readFile(inputFile.path);

    // ─── ROUTE 1: PDF -> DOCX (FORWARD TO PYTHON MICROSERVICE) ─────────────────
    if (sourceExt === 'pdf' && targetFormat === 'docx') {
      const form = new FormData();
      form.append('file', new Blob([fileBuffer]), inputFile.originalname);

      const response = await fetch(`${PDF2DOCX_URL}/convert`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        throw new Error(`Python pdf2docx service returned status ${response.status}`);
      }

      const resultBuffer = Buffer.from(await response.arrayBuffer());

      res.setHeader('Content-Disposition', `attachment; filename="converted.docx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      return res.send(resultBuffer);
    }

    // ─── ROUTE 2: MARKDOWN -> PDF (CHROMIUM ROUTE, NOT LIBREOFFICE) ────────────
    // Gotenberg's LibreOffice route has no markdown parser and rejects .md with a 400.
    // Markdown needs Chromium's dedicated route, which requires an index.html
    // wrapper that references the markdown file via the toHTML template helper.
    if (sourceExt === 'md' && targetFormat === 'pdf') {
      const form = new FormData();

      const indexHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  {{ toHTML "content.md" }}
</body>
</html>`;

      form.append('files', new Blob([indexHtml], { type: 'text/html' }), 'index.html');
      form.append('files', new Blob([fileBuffer]), 'content.md');

      const response = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/markdown`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        throw new Error(`Gotenberg markdown route returned ${response.status}`);
      }

      const resultBuffer = Buffer.from(await response.arrayBuffer());

      res.setHeader('Content-Disposition', `attachment; filename="converted.pdf"`);
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(resultBuffer);
    }

    // ─── ROUTE 3: OFFICE / TEXT DOCUMENTS -> PDF (FORWARD TO GOTENBERG/LIBREOFFICE) ──
    if (targetFormat === 'pdf') {
      const form = new FormData();
      form.append('files', new Blob([fileBuffer]), inputFile.originalname);

      const response = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        throw new Error(`Gotenberg returned ${response.status}`);
      }

      const resultBuffer = Buffer.from(await response.arrayBuffer());

      res.setHeader('Content-Disposition', `attachment; filename="converted.pdf"`);
      res.setHeader('Content-Type', 'application/pdf');
      return res.send(resultBuffer);
    }

    // If a request hits an unmapped combination
    return res.status(400).json({ error: `Conversion path ${sourceExt} -> ${targetFormat} is not supported.` });

  } catch (err) {
    console.error('Conversion failed:', err);
    res.status(500).json({ error: 'Conversion failed.' });
  } finally {
    await fs.unlink(inputFile.path).catch(() => {});
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 🔒 GLOBAL ERROR HANDLER FOR FILE SIZE OR EXTENSION SECURITY VIOLATIONS
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Security alert: File size exceeds the maximum allowed limit of 15MB.' });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));