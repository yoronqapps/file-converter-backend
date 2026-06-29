import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());

const upload = multer({ dest: path.join(__dirname, 'tmp') });

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://localhost:3000';

app.post('/convert', upload.single('file'), async (req, res) => {
  const targetFormat = req.body.target;
  const inputFile = req.file;

  if (!inputFile || !targetFormat) {
    return res.status(400).json({ error: 'Missing file or target format' });
  }

  try {
    if (targetFormat !== 'pdf') {
      return res.status(400).json({ error: `Only 'pdf' target is supported right now, got: ${targetFormat}` });
    }

    const fileBuffer = await fs.readFile(inputFile.path);
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
    res.send(resultBuffer);
  } catch (err) {
    console.error('Conversion failed:', err);
    res.status(500).json({ error: 'Conversion failed.' });
  } finally {
    await fs.unlink(inputFile.path).catch(() => {});
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));