// browser_read_more: the rest of an output that was cut to fit the budget.

import { freeTool, text, ToolError } from '../tools/types';
import { limitFor, readChunk } from './limit';

export const outputTools = {
  browser_read_more: freeTool(async (args, ctx) => {
    const chunk = readChunk(ctx.agent, String(args.handle ?? ''), Math.max(0, Number(args.offset ?? 0)), limitFor(args));
    if (chunk === undefined) throw new ToolError(`Unknown or expired handle "${args.handle}". Repeat the call that produced the long output.`);
    return text(chunk);
  }),
};
