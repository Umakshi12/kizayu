# Kizayu API: production image. Works on Railway, Render, Fly.io, or any Docker host.
# Needs DATABASE_URL (managed Postgres), JWT_SECRET (32+ random chars) and NODE_ENV=production. See README.
FROM node:22-slim

# Prisma needs OpenSSL at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# On every start: apply pending database migrations, make sure the games catalog exists, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx src/index.ts"]
