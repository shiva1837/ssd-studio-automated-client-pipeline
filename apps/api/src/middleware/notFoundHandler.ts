/**
 * SSD Studio — 404 Not Found Handler
 * Catches any request that did not match a registered route.
 */

import { Request, Response } from 'express';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: 'Not Found',
    code: 'ROUTE_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
};

export default notFoundHandler;
