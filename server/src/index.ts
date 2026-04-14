import dotenv from 'dotenv';
import { app } from './app';

dotenv.config({ path: '../.env' });

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
