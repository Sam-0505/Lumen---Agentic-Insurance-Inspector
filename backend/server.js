const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/upload-frames',      require('./routes/uploadFrames'));
app.use('/api/upload-frames',  require('./routes/uploadFrames'));
app.use('/job-status',         require('./routes/jobStatus'));
app.use('/api/job-status',     require('./routes/jobStatus'));
app.use('/splat',              require('./routes/serveSplat'));
app.use('/api/splat',          require('./routes/serveSplat'));
app.use('/analyze-damage',     require('./routes/analyzeDamage'));
app.use('/api/analyze-damage', require('./routes/analyzeDamage'));
app.use('/check-coverage',     require('./routes/checkCoverage'));
app.use('/api/check-coverage', require('./routes/checkCoverage'));
app.use('/ocr-document',       require('./routes/ocrDocument'));
app.use('/api/ocr-document',   require('./routes/ocrDocument'));
app.use('/save-frame',         require('./routes/saveFrame'));
app.use('/api/save-frame',     require('./routes/saveFrame'));
app.use('/scan-frame',         require('./routes/scanFrame'));
app.use('/api/scan-frame',     require('./routes/scanFrame'));
app.use('/notes',              require('./routes/saveNotes'));
app.use('/api/notes',          require('./routes/saveNotes'));
app.use('/scan-frames',        require('./routes/listScanFrames'));
app.use('/api/scan-frames',    require('./routes/listScanFrames'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/log', (req, res) => {
  const { msg, data } = req.body;
  console.log('[frontend]', msg, data !== undefined ? JSON.stringify(data) : '');
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend on port ${PORT}`));
