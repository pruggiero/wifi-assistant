import OpenAI from 'openai';
import { Router, Request, Response } from 'express';

const router = Router();

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

router.post('/', async (req: Request, res: Response) => {
  const { messages } = req.body as { messages: Message[] };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    });

    res.json({ message: completion.choices[0].message });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Failed to get a response. Please try again.' });
  }
});

export default router;
