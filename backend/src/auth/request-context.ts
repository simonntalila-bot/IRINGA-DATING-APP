/** Request metadata used for token/session auditing. Never trusted from input. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  deviceName?: string;
}

export const contextFrom = (req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
}): RequestContext => {
  const header = (name: string): string | undefined => {
    const value = req.headers[name] ?? req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  return {
    ip: req.ip,
    userAgent: header('user-agent'),
    deviceId: header('x-device-id'),
    deviceName: header('x-device-name'),
  };
};
