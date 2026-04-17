export const normalizeOrigin = (origin: string) =>
  origin.trim().replace(/\/+$/, '');

export const getCorsOrigins = (): string[] => {
  const corsOriginsEnv =
    process.env.CORS_ORIGINS?.trim() || process.env.CORS_ORIGIN?.trim();
  const defaultCorsOrigins = [
    'http://localhost:3001',
    'https://na-sua-porta-front.vercel.app',
  ];

  return (
    corsOriginsEnv
      ? corsOriginsEnv.split(',').map(normalizeOrigin)
      : defaultCorsOrigins
  ).filter((origin) => origin.length > 0);
};
