# ShortsFactory Cloud Worker — Railway deployt dieses Dockerfile automatisch,
# wenn das Service-Root-Directory auf `server/` zeigt.
FROM node:20-slim

# ffmpeg für den Render, DejaVu-Fonts für die eingebrannten Captions
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY openapi.json ./

# Railway setzt PORT; lokal 8080. Daten (Jobs/Keys) unter /data → Volume mounten.
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["node", "src/index.js"]
