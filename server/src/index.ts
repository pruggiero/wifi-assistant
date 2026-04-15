import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { app } from './app';

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
