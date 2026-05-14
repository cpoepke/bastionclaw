FROM node:22-slim

# better-sqlite3 requires native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install and build server
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# Install and build UI
COPY ui/package*.json ./ui/
RUN cd ui && npm ci
COPY ui/ ./ui/
RUN cd ui && npm run build

# Drop devDependencies + UI build tooling
RUN npm prune --omit=dev && rm -rf ui/node_modules ui/src

EXPOSE 8080
CMD ["node", "dist/index.js"]
