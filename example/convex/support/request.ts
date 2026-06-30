export type RequestMetadata = {
  clientIp?: string;
  userAgent?: string;
  requestId?: string;
};

export async function requestMetadata(ctx: {
  meta: {
    getRequestMetadata(): Promise<{
      ip: string | null;
      userAgent: string | null;
      requestId: string;
    }>;
  };
}): Promise<RequestMetadata> {
  const metadata = await ctx.meta.getRequestMetadata();
  return {
    clientIp: metadata.ip ?? undefined,
    userAgent: metadata.userAgent ?? undefined,
    requestId: metadata.requestId,
  };
}
