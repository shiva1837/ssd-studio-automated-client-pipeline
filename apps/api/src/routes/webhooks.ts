import { Router, Request, Response } from 'express';
import { logger } from '../lib/logger';

export const webhooksRouter = Router();

webhooksRouter.post('/stripe', (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  logger.info('Stripe webhook received', { hasSignature: !!sig });
  // TODO: Verify Stripe signature and process events
  res.json({ received: true });
});
