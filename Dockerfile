FROM node:20-alpine

WORKDIR /app

# Install all dependencies first for better layer caching (vite is a dev
# dependency and is required for the build step below)
COPY package*.json ./
RUN npm ci

# Build the frontend and copy the rest of the source
COPY . .
RUN npm run build

EXPOSE 3001
ENV PORT=3001

# The API proxy also serves the built app (dist/) — one process, one port
CMD ["node", "server.js"]
